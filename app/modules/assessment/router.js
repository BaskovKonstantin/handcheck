"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const config = require("../../config");
const {
  getPublishedBatteryTasks,
  assertBatteryComplete,
  lastSpecializationAttempt,
  cooldownActive,
} = require("./service");
const { loadAttemptForSubmit, assertAttemptMutable } = require("../../lib/assessment-guards");
const { validateAnswerText, answerMaxForType, WORK_ANSWER_MIN } = require("../../lib/assessment-answer");
const { ensureAttemptTimerStarted, deadlineAtIso } = require("../../lib/assessment-timing");
const { recordDraftTelemetry } = require("../../lib/assessment-telemetry");
const { submitAttemptAnswer } = require("../../lib/assessment-submit");

const router = express.Router();

router.use(requireAuth, requireConfirmedEmail, requireRole("candidate"));

router.post("/battery/start", (req, res, next) => {
  try {
    const specialization = String(req.body?.specialization || "").trim();
    const grade = String(req.body?.grade || "").trim();
    const allowedSpec = new Set(["backend", "frontend", "qa"]);
    const allowedGrade = new Set(["junior", "middle", "senior"]);
    if (!allowedSpec.has(specialization) || !allowedGrade.has(grade)) {
      throw httpError(400, "invalid_body", {
        fields: { category: "Выберите специализацию / грейд" },
      });
    }
    const db = getDb();
    const last = lastSpecializationAttempt(req.user.id, specialization);
    if (cooldownActive(last?.completed_at)) {
      const retake = new Date(last.completed_at);
      retake.setDate(retake.getDate() + Number(config.GRADE_COOLDOWN_DAYS || 90));
      throw httpError(409, "cooldown", {
        message: "Пересдача по этой специализации пока недоступна",
        retakeAt: retake.toISOString(),
      });
    }
    const formKey = Math.random() < 0.5 ? "A" : "B";
    const { quick, work } = getPublishedBatteryTasks(specialization, grade, formKey);
    try {
      assertBatteryComplete(quick, work);
    } catch (e) {
      if (e.code === "battery_incomplete") {
        throw httpError(409, "battery_incomplete", {
          message: "Батарея заданий для выбранной категории пока не готова",
        });
      }
      throw e;
    }
    const batteryId = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(batteryId, req.user.id, specialization, grade, formKey, now);
    const ins = db.prepare(
      `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, opened_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    );
    const order = [...quick, work];
    for (const t of order) {
      const attemptId = newId();
      ins.run(attemptId, req.user.id, t.id, batteryId, formKey);
    }
    res.status(201).json({ batteryId, formKey, taskCount: order.length });
  } catch (e) {
    next(e);
  }
});

router.get("/battery/current", (req, res) => {
  const db = getDb();
  const battery = db
    .prepare(
      `SELECT * FROM batteries WHERE candidate_user_id = ? AND completed_at IS NULL ORDER BY started_at DESC LIMIT 1`
    )
    .get(req.user.id);
  if (!battery) return res.json({ battery: null });
  const attempts = db
    .prepare(
      `SELECT id, task_id, submitted_at FROM attempts WHERE battery_id = ? ORDER BY rowid`
    )
    .all(battery.id);
  res.json({
    battery: {
      id: battery.id,
      specialization: battery.specialization,
      claimedGrade: battery.claimed_grade,
      formKey: battery.form_key,
      attempts: attempts.map((a) => ({ id: a.id, submitted: Boolean(a.submitted_at) })),
    },
  });
});

router.get("/tasks/:attemptId", (req, res, next) => {
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT a.id, a.battery_id, a.submitted_at, a.answer_text, a.opened_at, t.prompt, t.type FROM attempts a JOIN tasks t ON t.id = a.task_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
      )
      .get(req.params.attemptId, req.user.id);
    if (!row) return next(httpError(404, "not_found"));
    let openedAt = row.opened_at;
    if (!row.submitted_at) {
      const started = ensureAttemptTimerStarted(db, req.user.id, row.id);
      openedAt = started.opened_at || started.started_at;
    }
    res.json({
      id: row.id,
      prompt: row.prompt,
      type: row.type,
      answerMax: answerMaxForType(row.type),
      workAnswerMin: row.type === "work" ? WORK_ANSWER_MIN : undefined,
      draftText: row.submitted_at ? "" : String(row.answer_text || ""),
      openedAt,
      deadlineAt: openedAt ? deadlineAtIso(openedAt, row.type) : null,
      quickLimitSeconds: row.type === "quick" ? 60 : undefined,
    });
  } catch (e) {
    if (e.code === "not_current_task") {
      return next(httpError(409, "not_current_task", { message: "Сначала завершите предыдущий шаг теста." }));
    }
    next(e);
  }
});

router.patch("/tasks/:attemptId/draft", (req, res, next) => {
  const db = getDb();
  const a = loadAttemptForSubmit(req.params.attemptId, req.user.id);
  assertAttemptMutable(a);
  try {
    ensureAttemptTimerStarted(db, req.user.id, a.id);
  } catch (e) {
    if (e.code === "not_current_task") {
      return next(httpError(409, "not_current_task", { message: "Сначала завершите предыдущий шаг теста." }));
    }
    return next(e);
  }
  const parsed = validateAnswerText(req.body?.answerText, a.type);
  if (!parsed.ok && parsed.fields.answerText?.includes("длинный")) {
    return next(httpError(400, "invalid_body", { fields: parsed.fields }));
  }
  const prev = db.prepare("SELECT answer_text FROM attempts WHERE id = ?").get(a.id)?.answer_text || "";
  const text = parsed.ok ? parsed.value : String(req.body?.answerText || "").slice(0, answerMaxForType(a.type));
  recordDraftTelemetry(db, a.id, prev, text);
  db.prepare("UPDATE attempts SET answer_text = ? WHERE id = ?").run(text, a.id);
  db.prepare(
    `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'draft', ?)`
  ).run(a.id, JSON.stringify({ text: text.slice(0, 200), length: text.length }));
  res.json({ ok: true });
});

router.post("/tasks/:attemptId/submit", (req, res, next) => {
  try {
    const db = getDb();
    const a = loadAttemptForSubmit(req.params.attemptId, req.user.id);
    assertAttemptMutable(a);
    const result = submitAttemptAnswer(db, req.user.id, a, req.body?.answerText, { actionSource: "web" });
    res.json(result);
  } catch (e) {
    if (e.code === "quick_time_expired" || e.code === "deadline_passed") {
      const body = { ok: false, error: e.code, message: e.details?.message };
      if (e.details?.batteryComplete) Object.assign(body, e.details);
      return res.status(e.status || 409).json(body);
    }
    next(e);
  }
});

router.post("/events", (req, res, next) => {
  const items = Array.isArray(req.body?.events) ? req.body.events : [];
  const db = getDb();
  for (const ev of items) {
    if (ev.event_type === "opened_at") return next(httpError(400, "invalid_event"));
    const attemptId = ev.attemptId;
    const a = db
      .prepare("SELECT id FROM attempts WHERE id = ? AND candidate_user_id = ?")
      .get(attemptId, req.user.id);
    if (!a) return next(httpError(404, "not_found"));
    db.prepare(
      `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, ?, ?)`
    ).run(attemptId, ev.event_type, ev.payload ? JSON.stringify(ev.payload) : null);
  }
  res.json({ ok: true });
});

module.exports = router;
