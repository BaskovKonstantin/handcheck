"use strict";

function computeMotivation(events, openedAt, submittedAt, workDeadlineMs) {
  const opened = new Date(openedAt).getTime();
  const submitted = submittedAt ? new Date(submittedAt).getTime() : null;
  const deadline = opened + workDeadlineMs;

  const hasFirstInput = events.some((e) => e.event_type === "first_input");
  let start_bonus = 0;
  if (hasFirstInput) {
    const first = events.find((e) => e.event_type === "first_input");
    const firstAt = new Date(first.created_at).getTime();
    const minutes = (firstAt - opened) / 60000;
    if (minutes <= 3) start_bonus = 1;
    else if (minutes >= 15) start_bonus = 0;
    else start_bonus = (15 - minutes) / 12;
  }

  let finish_bonus = 0;
  if (submitted && submitted <= deadline) {
    finish_bonus = 1;
  }

  const draft_bonus = events.some((e) => e.event_type === "draft") ? 1 : 0;

  return (start_bonus + finish_bonus + draft_bonus) / 3;
}

module.exports = { computeMotivation };
