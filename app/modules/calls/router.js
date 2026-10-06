"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { httpError } = require("../../middleware/errors");
const config = require("../../config");
const { queueAnalyzeCall } = require("./analyze-call");
const { broadcastCallEnded } = require("./signaling");
const { isUuid } = require("../../lib/uuid");
const { rejectOversizedBody } = require("../../middleware/reject-oversized-body");
const { dbDateToIso } = require("../../lib/db-datetime");
const { summarizeAiUsageForEmployer } = require("../../lib/ai-usage-summary");
const { publicCandidateDisplayName } = require("../../lib/public-candidate-name");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail);

const RECORDING_LIMIT = 80 * 1024 * 1024;
const RECORDING_GRACE_MS = 45 * 1000;
const { assertWebmUpload } = require("../../lib/webm");

router.param("id", (req, res, next, id) => {
  if (!isUuid(id)) return next(httpError(400, "invalid_id"));
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECORDING_LIMIT },
});

function handleMulterUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(
        httpError(413, "file_too_large", {
          message: "Файл слишком большой (максимум 80 МБ)",
        })
      );
    }
    return next(httpError(400, "upload_failed"));
  });
}

function getInvitationAccess(userId, invitationId) {
  const db = getDb();
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(invitationId);
  if (!inv || inv.status !== "accepted") return null;
  if (![inv.candidate_user_id, inv.employer_user_id].includes(userId)) return null;
  return inv;
}

function callRecordingSides(call) {
  const root = call?.recording_path;
  if (!root) return [];
  const sides = [];
  for (const side of ["candidate", "employer"]) {
    const filePath = path.join(root, `${side}.webm`);
    if (fs.existsSync(filePath)) sides.push(side);
  }
  return sides;
}

function callDurationLabel(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `короткий звонок, меньше минуты`;
  const min = Math.floor(sec / 60);
  return `длительность около ${min} мин`;
}

function ensureCall(invitationId) {
  const db = getDb();
  let call = db.prepare("SELECT * FROM calls WHERE invitation_id = ?").get(invitationId);
  if (!call) {
    const id = newId();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status) VALUES (?, ?, 'ready')`
    ).run(id, invitationId);
    call = db.prepare("SELECT * FROM calls WHERE id = ?").get(id);
  }
  return call;
}

router.get("/for-invitation/:invitationId", (req, res, next) => {
  const inv = getInvitationAccess(req.user.id, req.params.invitationId);
  if (!inv) return next(httpError(403, "forbidden"));
  const call = ensureCall(inv.id);
  const db = getDb();
  const need = db.prepare("SELECT title FROM employer_needs WHERE id = ?").get(inv.need_id);
  const employer = db
    .prepare("SELECT company_name FROM employer_profiles WHERE user_id = ?")
    .get(inv.employer_user_id);
  const candidate = db
    .prepare(
      `SELECT cp.display_name, u.email FROM candidate_profiles cp
       JOIN users u ON u.id = cp.user_id WHERE cp.user_id = ?`
    )
    .get(inv.candidate_user_id);
  const payload = {
    callId: call.id,
    status: call.status,
    endedAt: call.ended_at ? dbDateToIso(call.ended_at) : null,
    startedAt: call.started_at ? dbDateToIso(call.started_at) : null,
    consentCandidate: Boolean(call.consent_at_candidate),
    consentEmployer: Boolean(call.consent_at_employer),
    needTitle: need?.title || "",
    companyName: employer?.company_name || "",
    candidateName: publicCandidateDisplayName(candidate?.display_name, candidate?.email),
    salaryFrom: inv.salary_from,
    salaryTo: inv.salary_to,
  };
  if (call.status === "ended") {
    payload.recordingSides = callRecordingSides(call);
    payload.durationHint = callDurationLabel(
      call.started_at ? dbDateToIso(call.started_at) : null,
      call.ended_at ? dbDateToIso(call.ended_at) : null
    );
    if (req.user.role === "employer") {
      const a = db.prepare("SELECT summary_text FROM call_analyses WHERE call_id = ?").get(call.id);
      if (a) payload.analysisText = a.summary_text;
      payload.aiUsage = summarizeAiUsageForEmployer(req.user.id, inv.candidate_user_id);
    }
  }
  res.json(payload);
});

router.post("/:id/consent", (req, res, next) => {
  if (req.body?.accepted !== true) {
    return next(
      httpError(400, "invalid_body", {
        fields: { accepted: "Подтвердите согласие на запись" },
      })
    );
  }
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.id);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (!inv || inv.status !== "accepted") return next(httpError(403, "forbidden"));
  const now = new Date().toISOString();
  if (req.user.id === inv.candidate_user_id) {
    db.prepare("UPDATE calls SET consent_at_candidate = ? WHERE id = ?").run(now, call.id);
  } else if (req.user.id === inv.employer_user_id) {
    db.prepare("UPDATE calls SET consent_at_employer = ? WHERE id = ?").run(now, call.id);
  } else return next(httpError(403, "forbidden"));
  res.json({ ok: true });
});

router.post("/:id/start", (req, res, next) => {
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.id);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (!inv || inv.status !== "accepted") return next(httpError(403, "forbidden"));
  const isCandidate = req.user.id === inv.candidate_user_id;
  const isEmployer = req.user.id === inv.employer_user_id;
  if (!isCandidate && !isEmployer) return next(httpError(403, "forbidden"));
  if (isCandidate && !call.consent_at_candidate) {
    return next(
      httpError(400, "consent_required", {
        message: "Подтвердите согласие на запись перед входом в комнату",
      })
    );
  }
  if (isEmployer && !call.consent_at_employer) {
    return next(
      httpError(400, "consent_required", {
        message: "Подтвердите согласие на запись перед входом в комнату",
      })
    );
  }
  const updated = db.prepare("SELECT * FROM calls WHERE id = ?").get(call.id);
  if (call.status === "ended") {
    return next(httpError(409, "call_ended"));
  }
  if (updated.consent_at_candidate && updated.consent_at_employer && updated.status === "ready") {
    const now = new Date().toISOString();
    db.prepare("UPDATE calls SET status = 'live', started_at = ? WHERE id = ?").run(now, call.id);
  }
  const status = db.prepare("SELECT status FROM calls WHERE id = ?").get(call.id).status;
  res.json({ ok: true, status });
});

router.post("/:id/end", (req, res, next) => {
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.id);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (!inv) return next(httpError(404, "not_found"));
  if (![inv.candidate_user_id, inv.employer_user_id].includes(req.user.id)) {
    return next(httpError(403, "forbidden"));
  }
  if (call.status === "ended") {
    return res.json({ ok: true, status: "ended" });
  }
  if (call.status !== "live") {
    return next(
      httpError(409, "call_not_live", {
        fields: { call: "Завершить можно только активный звонок" },
      })
    );
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE calls SET status = 'ended', ended_at = ? WHERE id = ?").run(now, call.id);
  broadcastCallEnded(call.id);
  queueAnalyzeCall(call.id);
  res.json({ ok: true });
});

router.post(
  "/:id/recording",
  rejectOversizedBody(RECORDING_LIMIT),
  handleMulterUpload,
  (req, res, next) => {
  const callId = req.params.id;
  if (!req.file?.buffer) return next(httpError(400, "file_required"));
  if (!assertWebmUpload(req.file)) {
    return next(
      httpError(400, "invalid_recording", {
        fields: { file: "Нужен файл записи в формате WebM" },
      })
    );
  }
  const db = getDb();
  const call = db.prepare("SELECT id, invitation_id, status, ended_at FROM calls WHERE id = ?").get(callId);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT candidate_user_id, employer_user_id FROM invitations WHERE id = ?").get(
    call.invitation_id
  );
  if (!inv || ![inv.candidate_user_id, inv.employer_user_id].includes(req.user.id)) {
    return next(httpError(403, "forbidden"));
  }
  const side =
    req.user.id === inv.candidate_user_id
      ? "candidate"
      : req.user.id === inv.employer_user_id
        ? "employer"
        : null;
  if (!side) return next(httpError(403, "forbidden"));
  if (call.status === "ended") {
    const endedAt = call.ended_at ? new Date(call.ended_at).getTime() : 0;
    if (Date.now() - endedAt > RECORDING_GRACE_MS) {
      return next(
        httpError(409, "call_ended", { message: "Звонок уже завершён" })
      );
    }
  } else if (call.status !== "live") {
    return next(httpError(409, "call_not_live"));
  }
  const callsRoot = path.resolve(config.CALLS_DIR);
  const dir = path.resolve(callsRoot, callId);
  if (!dir.startsWith(callsRoot + path.sep) && dir !== callsRoot) {
    return next(httpError(400, "invalid_path"));
  }
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${side}.webm`);
  if (path.resolve(filePath) !== filePath || !filePath.endsWith(`${side}.webm`)) {
    return next(httpError(400, "invalid_path"));
  }
  if (call.status === "ended" && fs.existsSync(filePath)) {
    return next(httpError(409, "call_ended", { message: "Звонок уже завершён" }));
  }
  fs.writeFileSync(filePath, req.file.buffer);
  db.prepare("UPDATE calls SET recording_path = ? WHERE id = ?").run(dir, call.id);
  res.json({ ok: true });
  }
);

router.post("/:id/transcript-chunk", (req, res, next) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    return next(httpError(400, "invalid_body", { fields: { text: "Напишите реплику" } }));
  }
  const CHUNK_MAX = 4000;
  const TRANSCRIPT_MAX = 20_000;
  if (text.length > CHUNK_MAX) {
    return next(
      httpError(400, "invalid_body", {
        fields: { text: `Реплика слишком длинная (максимум ${CHUNK_MAX} символов)` },
      })
    );
  }
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.id);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (![inv.candidate_user_id, inv.employer_user_id].includes(req.user.id)) {
    return next(httpError(403, "forbidden"));
  }
  if (call.status !== "live") {
    return next(httpError(409, "call_not_live"));
  }
  const roleLabel =
    req.user.id === inv.candidate_user_id ? "Кандидат" : "Работодатель";
  const chunk = new RegExp(`^${roleLabel}\\s*:`, "i").test(text) ? text : `${roleLabel}: ${text}`;
  const merged = (call.transcript_text ? `${call.transcript_text} ` : "") + chunk;
  const trimmed = merged.trim();
  if (trimmed.length > TRANSCRIPT_MAX) {
    return next(
      httpError(400, "invalid_body", {
        fields: { text: `Транскрипт слишком длинный (максимум ${TRANSCRIPT_MAX} символов)` },
      })
    );
  }
  db.prepare("UPDATE calls SET transcript_text = ? WHERE id = ?").run(trimmed, call.id);
  res.json({ ok: true });
});

router.get("/:id/analysis", (req, res, next) => {
  if (req.user.role !== "employer") return next(httpError(403, "forbidden"));
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.id);
  if (!call || call.status !== "ended") return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (inv.employer_user_id !== req.user.id) return next(httpError(403, "forbidden"));
  const a = db.prepare("SELECT summary_text FROM call_analyses WHERE call_id = ?").get(call.id);
  if (!a) return next(httpError(404, "not_ready"));
  res.json({
    summaryText: a.summary_text,
    summary_text: a.summary_text,
    aiUsage: summarizeAiUsageForEmployer(req.user.id, inv.candidate_user_id),
  });
});

router.get("/:id/recording", (req, res, next) => {
  const side = req.query.side;
  if (!["candidate", "employer"].includes(side)) return next(httpError(400, "invalid_side"));
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.id);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (![inv.candidate_user_id, inv.employer_user_id].includes(req.user.id)) {
    return next(httpError(403, "forbidden"));
  }
  const filePath = path.join(call.recording_path || "", `${side}.webm`);
  if (!fs.existsSync(filePath)) return next(httpError(404, "not_found"));
  res.type("video/webm");
  res.sendFile(filePath);
});

module.exports = router;
