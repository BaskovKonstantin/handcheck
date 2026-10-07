"use strict";

const { getCurrentAttemptId, isPastDeadline } = require("./assessment-timing");
const { submitAttemptAnswer } = require("./assessment-submit");

/**
 * Close any quick attempt whose minute has elapsed while the candidate was away.
 * Returns how many attempts were auto-submitted.
 */
function expireStaleOpenQuickAttempts(db, userId, batteryId) {
  let closed = 0;
  for (let guard = 0; guard < 12; guard += 1) {
    const currentId = getCurrentAttemptId(db, batteryId);
    if (!currentId) break;
    const row = db
      .prepare(
        `SELECT a.*, t.type
         FROM attempts a
         JOIN tasks t ON t.id = a.task_id
         WHERE a.id = ? AND a.candidate_user_id = ?`
      )
      .get(currentId, userId);
    if (!row || row.submitted_at || row.type !== "quick" || !row.opened_at) break;
    if (!isPastDeadline(row.opened_at, "quick")) break;
    try {
      submitAttemptAnswer(db, userId, row, row.answer_text || "", { actionSource: "web" });
      closed += 1;
    } catch (e) {
      if (e.code === "quick_time_expired") {
        closed += 1;
        continue;
      }
      throw e;
    }
  }
  return closed;
}

module.exports = { expireStaleOpenQuickAttempts };
