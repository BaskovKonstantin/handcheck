"use strict";

/** Mimics web UI typing telemetry so integrity logic sees accounted characters. */
async function postTypedAnswerTelemetry(agent, attemptId, answerText) {
  const len = String(answerText || "").length;
  if (!len) return;
  await agent.post("/api/assessment/events").send({
    events: [
      { attemptId, event_type: "first_input", payload: { length: 1 } },
      { attemptId, event_type: "typing", payload: { chars: len } },
    ],
  });
}

module.exports = { postTypedAnswerTelemetry };
