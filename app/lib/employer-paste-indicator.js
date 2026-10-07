"use strict";

const { computeAttemptIntegrity } = require("./integrity");

/**
 * Employer-visible paste signal (not numeric integrity).
 *
 * Rule: on the candidate's latest battery, sum pastedChars and answerLength across
 * submitted quick (short) questions only. Mark when pastedChars / answerLength
 * is strictly greater than 0.5 (majority of characters from paste), and total
 * quick answer length is at least MIN_QUICK_ANSWER_CHARS_TOTAL (avoids noise on
 * tiny samples).
 */
const QUICK_PASTE_HEAVY_CHAR_RATIO = 0.5;
const MIN_QUICK_ANSWER_CHARS_TOTAL = 24;

const PASTE_INPUT_MARK_LABEL =
  "Ответы на короткие вопросы в основном вставлены из буфера";

function parseStoredMetrics(json) {
  if (!json) return null;
  try {
    const m = JSON.parse(json);
    const pastedChars = Number(m.pastedChars);
    const answerLength = Number(m.answerLength);
    if (!Number.isFinite(pastedChars) || !Number.isFinite(answerLength)) return null;
    return { pastedChars: Math.max(0, pastedChars), answerLength: Math.max(0, answerLength) };
  } catch {
    return null;
  }
}

function metricsForQuickAttempt(db, attempt) {
  const stored = parseStoredMetrics(attempt.integrity_metrics_json);
  if (stored && stored.answerLength > 0) return stored;
  const events = db
    .prepare("SELECT * FROM attempt_events WHERE attempt_id = ? ORDER BY created_at")
    .all(attempt.id);
  if (!events.length && !attempt.submitted_at) return null;
  const { metrics } = computeAttemptIntegrity(events, attempt);
  return {
    pastedChars: metrics.pastedChars || 0,
    answerLength: metrics.answerLength || 0,
  };
}

function aggregateQuickPasteTotals(quickMetrics) {
  let pastedChars = 0;
  let answerLength = 0;
  for (const m of quickMetrics) {
    if (!m || m.answerLength <= 0) continue;
    pastedChars += m.pastedChars;
    answerLength += m.answerLength;
  }
  return { pastedChars, answerLength };
}

/**
 * @param {number} pastedChars
 * @param {number} answerLength
 * @returns {boolean}
 */
function isQuickPasteHeavyByTotals(pastedChars, answerLength) {
  if (answerLength < MIN_QUICK_ANSWER_CHARS_TOTAL) return false;
  return pastedChars / answerLength > QUICK_PASTE_HEAVY_CHAR_RATIO;
}

/**
 * @param {{ pastedChars: number, answerLength: number }[]} quickMetrics
 */
function isQuickPasteHeavyFromMetrics(quickMetrics) {
  const { pastedChars, answerLength } = aggregateQuickPasteTotals(quickMetrics);
  return isQuickPasteHeavyByTotals(pastedChars, answerLength);
}

function loadLatestBatteryQuickAttempts(db, candidateUserId) {
  const battery = db
    .prepare(
      `SELECT id FROM batteries WHERE candidate_user_id = ? AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`
    )
    .get(candidateUserId);
  if (!battery) return [];
  return db
    .prepare(
      `SELECT a.* FROM attempts a
       JOIN tasks t ON t.id = a.task_id
       WHERE a.battery_id = ? AND t.type = 'quick' AND a.submitted_at IS NOT NULL`
    )
    .all(battery.id);
}

/**
 * Employer-only hint when quick answers were mostly pasted. Null when not applicable.
 * @param {import('better-sqlite3').Database} db
 * @param {string} candidateUserId
 * @returns {{ label: string } | null}
 */
function getEmployerPasteInputMark(db, candidateUserId) {
  const attempts = loadLatestBatteryQuickAttempts(db, candidateUserId);
  if (!attempts.length) return null;
  const metrics = attempts.map((a) => metricsForQuickAttempt(db, a)).filter(Boolean);
  if (!isQuickPasteHeavyFromMetrics(metrics)) return null;
  return { label: PASTE_INPUT_MARK_LABEL };
}

module.exports = {
  QUICK_PASTE_HEAVY_CHAR_RATIO,
  MIN_QUICK_ANSWER_CHARS_TOTAL,
  PASTE_INPUT_MARK_LABEL,
  aggregateQuickPasteTotals,
  isQuickPasteHeavyByTotals,
  isQuickPasteHeavyFromMetrics,
  getEmployerPasteInputMark,
};
