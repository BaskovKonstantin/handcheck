"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const {
  startBattery,
  submitAttempt,
} = require("./actions");

const router = express.Router();

router.use(requireAuth, requireConfirmedEmail, requireRole("candidate"));

router.post("/battery/start", (req, res, next) => {
  try {
    const result = startBattery(
      req.user.id,
      req.body?.specialization,
      req.body?.grade
    );
    res.status(201).json(result);
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
      `SELECT id, task_id, submitted_at FROM attempts WHERE battery_id = ? ORDER BY opened_at`
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
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.id, a.battery_id, t.prompt, t.type FROM attempts a JOIN tasks t ON t.id = a.task_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(req.params.attemptId, req.user.id);
  if (!row) return next(httpError(404, "not_found"));
  res.json({ id: row.id, prompt: row.prompt, type: row.type });
});

router.patch("/tasks/:attemptId/draft", (req, res, next) => {
  const text = String(req.body?.answerText || "");
  const db = getDb();
  const a = db
    .prepare("SELECT * FROM attempts WHERE id = ? AND candidate_user_id = ?")
    .get(req.params.attemptId, req.user.id);
  if (!a) return next(httpError(404, "not_found"));
  db.prepare("UPDATE attempts SET answer_text = ? WHERE id = ?").run(text, a.id);
  db.prepare(
    `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'draft', ?)`
  ).run(a.id, JSON.stringify({ text: text.slice(0, 200), length: text.length }));
  res.json({ ok: true });
});

router.post("/tasks/:attemptId/submit", (req, res, next) => {
  try {
    const result = submitAttempt(req.user.id, req.params.attemptId, req.body?.answerText, {
      source: "web",
    });
    res.json(result);
  } catch (e) {
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
