"use strict";

const { scoreQuick, scoreWork } = require("./rubric-score");
const { validateAnswerText } = require("./assessment-answer");
const { httpError } = require("../middleware/errors");
const { finalizeBattery } = require("../modules/assessment/service");
const {
  isPastDeadline,
  assertCurrentAttempt,
  assertAttemptOpened,
  QUICK_DEADLINE_MS,
} = require("./assessment-timing");
const { recordDraftTelemetry } = require("./assessment-telemetry");

function submitAttemptAnswer(db, userId, attemptRow, answerText, meta = {}) {
  const a = attemptRow;
  const current = assertCurrentAttempt(db, userId, a.id);
  assertAttemptOpened(current);
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

  const incomingTrim = String(answerText ?? "").trim();
  const quickWindowClosed =
    refreshed.type === "quick" &&
    refreshed.opened_at &&
    Date.now() > new Date(refreshed.opened_at).getTime() + QUICK_DEADLINE_MS;
  const quickExpired =
    refreshed.type === "quick" &&
    (isPastDeadline(refreshed.opened_at, "quick") || (quickWindowClosed && !incomingTrim));
  const workExpired =
    refreshed.type === "work" && isPastDeadline(refreshed.opened_at, "work");

  const incoming = String(answerText ?? "");
  // incomingTrim computed above for quickExpired empty-at-deadline
  const draftBefore = String(refreshed.answer_text || "");
  const scoredText = quickExpired ? draftBefore : incoming;
  const lateExtra =
    quickExpired && incoming.trim() && incoming.trim() !== draftBefore.trim() ? incoming.trim() : "";

  let text = "";
  if (quickExpired && refreshed.type === "quick") {
    if (draftBefore.trim()) {
      const parsed = validateAnswerText(draftBefore, refreshed.type);
      if (!parsed.ok) {
        throw httpError(400, "invalid_body", { fields: parsed.fields });
      }
      text = parsed.value;
    } else {
      text = "";
    }
  } else {
    const parsed = validateAnswerText(incoming, refreshed.type);
    if (!parsed.ok) {
      throw httpError(400, "invalid_body", { fields: parsed.fields });
    }
    text = parsed.value;
  }

  if (!quickExpired) {
    recordDraftTelemetry(db, refreshed.id, refreshed.answer_text, text, meta);
  }

  if (workExpired) {
    db.prepare("UPDATE attempts SET answer_text = ? WHERE id = ?").run(incoming.trim(), refreshed.id);
    throw httpError(409, "deadline_passed", {
      message: "Срок на мини-проект истёк. Текст сохранён, но сдать работу уже нельзя.",
    });
  }

  const rubric = JSON.parse(refreshed.rubric_json);
  const scores =
    text.trim().length > 0
      ? refreshed.type === "quick"
        ? scoreQuick(text, rubric)
        : scoreWork(text, rubric)
      : { knowledge: 0, breadth: 0 };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE attempts SET answer_text = ?, late_answer_text = ?, knowledge = ?, breadth = ?, submitted_at = ?, action_source = COALESCE(?, action_source), timed_out = ? WHERE id = ?`
  ).run(
    text,
    lateExtra || null,
    scores.knowledge,
    scores.breadth,
    now,
    meta.actionSource || null,
    quickExpired ? 1 : 0,
    refreshed.id
  );
  const submitPayload = {
    length: text.length,
    source: meta.actionSource || "web",
    timedOut: quickExpired,
    lateLength: lateExtra.length,
  };
  db.prepare(
    `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'submit', ?)`
  ).run(refreshed.id, JSON.stringify(submitPayload));
  if (quickExpired) {
    db.prepare(
      `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'quick_timeout', ?)`
    ).run(refreshed.id, JSON.stringify({ length: text.length, lateLength: lateExtra.length }));
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
        lateExtra.length > 0
          ? "Время на этот короткий ответ истекло. Ответ до дедлайна сохранён; текст после истечения времени не засчитан как вовремя."
          : text.trim()
            ? "Время на этот короткий ответ истекло. Ответ сохранён, но не засчитан как вовремя."
            : "Время вышло — ответ не засчитан как вовремя. Переходим к следующему вопросу.",
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
