"use strict";

const { scoreQuick, scoreWork } = require("./rubric-score");
const { validateAnswerText } = require("./assessment-answer");
const { httpError } = require("../middleware/errors");
const { finalizeBattery } = require("../modules/assessment/service");
const { isPastDeadline, ensureAttemptTimerStarted } = require("./assessment-timing");
const { recordDraftTelemetry } = require("./assessment-telemetry");

function submitAttemptAnswer(db, userId, attemptRow, answerText, meta = {}) {
  const a = attemptRow;
  ensureAttemptTimerStarted(db, userId, a.id);
  const refreshed = db
    .prepare(
      `SELECT a.*, t.type, t.rubric_json, b.claimed_grade, b.id AS battery_id
       FROM attempts a
       JOIN tasks t ON t.id = a.task_id
       JOIN batteries b ON b.id = a.battery_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(a.id, userId);
  if (!refreshed || refreshed.submitted_at) {
    const err = new Error("already_submitted");
    err.status = 409;
    err.code = "already_submitted";
    throw err;
  }

  const parsed = validateAnswerText(answerText, refreshed.type);
  if (!parsed.ok) {
    throw httpError(400, "invalid_body", { fields: parsed.fields });
  }
  const text = parsed.value;
  recordDraftTelemetry(db, refreshed.id, refreshed.answer_text, text);

  const quickExpired =
    refreshed.type === "quick" && isPastDeadline(refreshed.opened_at, "quick");
  const workExpired =
    refreshed.type === "work" && isPastDeadline(refreshed.opened_at, "work");

  if (workExpired) {
    db.prepare("UPDATE attempts SET answer_text = ? WHERE id = ?").run(text, refreshed.id);
    throw httpError(409, "deadline_passed", {
      message: "Срок на мини-проект истёк. Текст сохранён, но сдать работу уже нельзя.",
    });
  }

  const rubric = JSON.parse(refreshed.rubric_json);
  const scores = refreshed.type === "quick" ? scoreQuick(text, rubric) : scoreWork(text, rubric);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE attempts SET answer_text = ?, knowledge = ?, breadth = ?, submitted_at = ?, action_source = COALESCE(?, action_source) WHERE id = ?`
  ).run(
    text,
    scores.knowledge,
    scores.breadth,
    now,
    meta.actionSource || null,
    refreshed.id
  );
  const submitPayload = {
    length: text.length,
    source: meta.actionSource || "web",
    timedOut: quickExpired,
  };
  db.prepare(
    `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'submit', ?)`
  ).run(refreshed.id, JSON.stringify(submitPayload));
  if (quickExpired) {
    db.prepare(
      `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'quick_timeout', ?)`
    ).run(refreshed.id, JSON.stringify({ length: text.length }));
  }

  const pending = db
    .prepare(`SELECT COUNT(*) AS c FROM attempts WHERE battery_id = ? AND submitted_at IS NULL`)
    .get(refreshed.battery_id).c;

  let batteryResult = null;
  if (pending === 0) {
    batteryResult = finalizeBattery(refreshed.battery_id, userId, refreshed.claimed_grade);
  }

  if (quickExpired) {
    throw httpError(409, "quick_time_expired", {
      message:
        "Время на этот короткий ответ истекло (лимит — одна минута). Текст сохранён и учтён в оценке.",
      batteryComplete: pending === 0,
      ...batteryResult,
    });
  }

  return {
    ok: true,
    batteryComplete: pending === 0,
    ...batteryResult,
  };
}

module.exports = { submitAttemptAnswer };
