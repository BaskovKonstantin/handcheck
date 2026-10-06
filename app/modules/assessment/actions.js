"use strict";

const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { httpError } = require("../../middleware/errors");
const { scoreQuick, scoreWork } = require("../../lib/rubric-score");
const {
  getPublishedBatteryTasks,
  assertBatteryComplete,
  lastSpecializationAttempt,
  cooldownActive,
  finalizeBattery,
  WORK_DEADLINE_MS,
} = require("./service");

function normalizeSource(source) {
  return source === "mcp" ? "mcp" : "web";
}

function startBattery(userId, specialization, grade) {
  const spec = String(specialization || "").trim();
  const gr = String(grade || "").trim();
  if (!spec || !gr) throw httpError(400, "invalid_body");
  const db = getDb();
  const last = lastSpecializationAttempt(userId, spec);
  if (cooldownActive(last?.completed_at)) throw httpError(409, "cooldown");
  const formKey = Math.random() < 0.5 ? "A" : "B";
  const { quick, work } = getPublishedBatteryTasks(spec, gr, formKey);
  assertBatteryComplete(quick, work);
  const batteryId = newId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(batteryId, userId, spec, gr, formKey, now);
  const ins = db.prepare(
    `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, opened_at, submit_source)
     VALUES (?, ?, ?, ?, ?, ?, 'web')`
  );
  const order = [...quick, work];
  for (const t of order) {
    const attemptId = newId();
    ins.run(attemptId, userId, t.id, batteryId, formKey, now);
    db.prepare(
      `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'opened_at', NULL)`
    ).run(attemptId);
  }
  return { batteryId, formKey, taskCount: order.length };
}

function submitAttempt(userId, attemptId, answerText, options = {}) {
  const text = String(answerText || "");
  const source = normalizeSource(options.source);
  const db = getDb();
  const a = db
    .prepare(
      `SELECT a.*, t.type, t.rubric_json, b.claimed_grade, b.id AS battery_id
       FROM attempts a JOIN tasks t ON t.id = a.task_id JOIN batteries b ON b.id = a.battery_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, userId);
  if (!a) throw httpError(404, "not_found");
  if (a.type === "work") {
    const opened = new Date(a.opened_at).getTime();
    if (Date.now() > opened + WORK_DEADLINE_MS) throw httpError(409, "deadline_passed");
  }
  const rubric = JSON.parse(a.rubric_json);
  const scores = a.type === "quick" ? scoreQuick(text, rubric) : scoreWork(text, rubric);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE attempts SET answer_text = ?, knowledge = ?, breadth = ?, submitted_at = ?, submit_source = ? WHERE id = ?`
  ).run(text, scores.knowledge, scores.breadth, now, source, a.id);
  db.prepare(
    `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'submit', ?)`
  ).run(a.id, JSON.stringify({ length: text.length, source }));

  const pending = db
    .prepare(`SELECT COUNT(*) AS c FROM attempts WHERE battery_id = ? AND submitted_at IS NULL`)
    .get(a.battery_id).c;
  if (pending === 0) {
    const result = finalizeBattery(a.battery_id, userId, a.claimed_grade);
    return { ok: true, batteryComplete: true, ...result };
  }
  return { ok: true, batteryComplete: false };
}

module.exports = { startBattery, submitAttempt, normalizeSource };
