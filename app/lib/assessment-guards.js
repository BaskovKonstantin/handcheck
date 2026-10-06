"use strict";

const { getDb } = require("../db");
const { httpError } = require("../middleware/errors");

function loadAttemptForSubmit(attemptId, userId) {
  const row = getDb()
    .prepare(
      `SELECT a.*, t.type, t.rubric_json, b.claimed_grade, b.id AS battery_id, b.completed_at AS battery_completed_at
       FROM attempts a
       JOIN tasks t ON t.id = a.task_id
       JOIN batteries b ON b.id = a.battery_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, userId);
  if (!row) throw httpError(404, "not_found");
  return row;
}

function assertAttemptMutable(attempt) {
  if (attempt.submitted_at || attempt.battery_completed_at) {
    throw httpError(409, "already_submitted", {
      fields: { answer: "Ответ уже отправлен" },
    });
  }
}

module.exports = { loadAttemptForSubmit, assertAttemptMutable };
