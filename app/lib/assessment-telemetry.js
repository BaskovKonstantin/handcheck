"use strict";

/** Only flag paste when client did not report typing for the same growth window. */
function recordDraftTelemetry(db, attemptId, previousText, newText, meta = {}) {
  if (meta.actionSource === "mcp") return;
  const prevLen = String(previousText || "").length;
  const newLen = String(newText || "").length;
  if (prevLen === 0 && newLen > 0) {
    const hasFirst = db
      .prepare(
        `SELECT 1 FROM attempt_events WHERE attempt_id = ? AND event_type = 'first_input' LIMIT 1`
      )
      .get(attemptId);
    if (!hasFirst) {
      db.prepare(
        `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'first_input', ?)`
      ).run(attemptId, JSON.stringify({ length: newLen }));
    }
  }
}

function sumTypingChars(db, attemptId) {
  const rows = db
    .prepare(
      `SELECT payload_json FROM attempt_events WHERE attempt_id = ? AND event_type = 'typing'`
    )
    .all(attemptId);
  let total = 0;
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload_json || "{}");
      total += Number(p.chars) || 0;
    } catch {
      /* ignore */
    }
  }
  return total;
}

module.exports = { recordDraftTelemetry, sumTypingChars };
