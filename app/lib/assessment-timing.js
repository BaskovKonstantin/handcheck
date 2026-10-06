"use strict";

const BATTERY_QUICK_COUNT = 8;
const QUICK_DEADLINE_MS = 60 * 1000;
const WORK_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;

function deadlineMsForType(type) {
  return type === "quick" ? QUICK_DEADLINE_MS : WORK_DEADLINE_MS;
}

function deadlineAtIso(openedAt, type) {
  if (!openedAt) return null;
  const ms = new Date(openedAt).getTime() + deadlineMsForType(type);
  return new Date(ms).toISOString();
}

function isPastDeadline(openedAt, type, nowMs = Date.now()) {
  if (!openedAt) return false;
  return nowMs > new Date(openedAt).getTime() + deadlineMsForType(type);
}

function getCurrentAttemptId(db, batteryId) {
  const row = db
    .prepare(
      `SELECT id FROM attempts WHERE battery_id = ? AND submitted_at IS NULL ORDER BY rowid LIMIT 1`
    )
    .get(batteryId);
  return row?.id || null;
}

/** Start per-task timer when the candidate opens the active attempt. */
function ensureAttemptTimerStarted(db, userId, attemptId) {
  const row = db
    .prepare(
      `SELECT a.id, a.battery_id, a.started_at, a.submitted_at, a.candidate_user_id
       FROM attempts a WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, userId);
  if (!row || row.submitted_at) return row;
  const currentId = getCurrentAttemptId(db, row.battery_id);
  if (currentId !== attemptId) {
    const err = new Error("not_current_task");
    err.status = 409;
    err.code = "not_current_task";
    throw err;
  }
  if (!row.started_at) {
    const now = new Date().toISOString();
    db.prepare("UPDATE attempts SET started_at = ?, opened_at = ? WHERE id = ?").run(now, now, attemptId);
    db.prepare(
      `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'opened_at', NULL)`
    ).run(attemptId);
    return { ...row, started_at: now, opened_at: now };
  }
  const refreshed = db
    .prepare(`SELECT id, battery_id, started_at, opened_at, submitted_at FROM attempts WHERE id = ?`)
    .get(attemptId);
  return refreshed;
}

module.exports = {
  BATTERY_QUICK_COUNT,
  QUICK_DEADLINE_MS,
  WORK_DEADLINE_MS,
  deadlineMsForType,
  deadlineAtIso,
  isPastDeadline,
  getCurrentAttemptId,
  ensureAttemptTimerStarted,
};
