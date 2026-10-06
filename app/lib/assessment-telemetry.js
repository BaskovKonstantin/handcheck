"use strict";

const LARGE_INSERT_CHARS = 40;

function recordDraftTelemetry(db, attemptId, previousText, newText) {
  const prevLen = String(previousText || "").length;
  const newLen = String(newText || "").length;
  const delta = newLen - prevLen;
  if (delta >= LARGE_INSERT_CHARS) {
    const recentPaste = db
      .prepare(
        `SELECT 1 FROM attempt_events WHERE attempt_id = ? AND event_type = 'paste'
         AND datetime(created_at) >= datetime('now', '-2 seconds') LIMIT 1`
      )
      .get(attemptId);
    if (!recentPaste) {
      db.prepare(
        `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'paste', ?)`
      ).run(
        attemptId,
        JSON.stringify({ source: "server_bulk_insert", chars: delta, prevLen, newLen })
      );
    }
  }
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

module.exports = { recordDraftTelemetry, LARGE_INSERT_CHARS };
