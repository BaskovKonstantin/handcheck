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
const { isUuid } = require("../../lib/uuid");
const { rejectOversizedBody } = require("../../middleware/reject-oversized-body");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail);

const RECORDING_LIMIT = 80 * 1024 * 1024;

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
      return next(httpError(413, "file_too_large"));
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
  res.json({
    callId: call.id,
    status: call.status,
    consentCandidate: Boolean(call.consent_at_candidate),
    consentEmployer: Boolean(call.consent_at_employer),
  });
});

router.post("/:id/consent", (req, res, next) => {
  if (req.body?.accepted !== true) return next(httpError(400, "invalid_body"));
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
  if (isCandidate && !call.consent_at_candidate) return next(httpError(400, "consent_required"));
  if (isEmployer && !call.consent_at_employer) return next(httpError(400, "consent_required"));
  const updated = db.prepare("SELECT * FROM calls WHERE id = ?").get(call.id);
  if (updated.consent_at_candidate && updated.consent_at_employer && updated.status === "ready") {
    const now = new Date().toISOString();
    db.prepare("UPDATE calls SET status = 'live', started_at = ? WHERE id = ?").run(now, call.id);
  }
  res.json({ ok: true, status: db.prepare("SELECT status FROM calls WHERE id = ?").get(call.id).status });
});

router.post("/:id/end", (req, res, next) => {
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.id);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (![inv.candidate_user_id, inv.employer_user_id].includes(req.user.id)) {
    return next(httpError(403, "forbidden"));
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE calls SET status = 'ended', ended_at = ? WHERE id = ?").run(now, call.id);
  queueAnalyzeCall(call.id);
  res.json({ ok: true });
});

router.post(
  "/:id/recording",
  rejectOversizedBody(RECORDING_LIMIT),
  handleMulterUpload,
  (req, res, next) => {
  const callId = req.params.id;
  const side = req.body?.side;
  if (!["candidate", "employer"].includes(side)) return next(httpError(400, "invalid_side"));
  if (!req.file?.buffer) return next(httpError(400, "file_required"));
  const db = getDb();
  const call = db.prepare("SELECT id, invitation_id FROM calls WHERE id = ?").get(callId);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT candidate_user_id, employer_user_id FROM invitations WHERE id = ?").get(
    call.invitation_id
  );
  if (!inv || ![inv.candidate_user_id, inv.employer_user_id].includes(req.user.id)) {
    return next(httpError(403, "forbidden"));
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
  fs.writeFileSync(filePath, req.file.buffer);
  db.prepare("UPDATE calls SET recording_path = ? WHERE id = ?").run(dir, call.id);
  res.json({ ok: true });
  }
);

router.post("/:id/transcript-chunk", (req, res, next) => {
  const text = String(req.body?.text || "").trim();
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.id);
  if (!call) return next(httpError(404, "not_found"));
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (![inv.candidate_user_id, inv.employer_user_id].includes(req.user.id)) {
    return next(httpError(403, "forbidden"));
  }
  const merged = (call.transcript_text + " " + text).trim();
  db.prepare("UPDATE calls SET transcript_text = ? WHERE id = ?").run(merged, call.id);
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
  res.json({ summary_text: a.summary_text });
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
  res.sendFile(filePath);
});

module.exports = router;
