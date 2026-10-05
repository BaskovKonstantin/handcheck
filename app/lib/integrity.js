"use strict";

function computeIntegrity(events, answerLengths) {
  const paste = events.filter((e) => e.event_type === "paste").length;
  const firstInput = events.filter((e) => e.event_type === "first_input").length;
  const blur = events.filter((e) => e.event_type === "blur").length;

  const paste_ratio = paste / Math.max(1, paste + firstInput);

  let jump_flag = 0;
  const drafts = events.filter((e) => e.event_type === "draft" || e.event_type === "submit");
  for (let i = 1; i < answerLengths.length; i++) {
    const prev = answerLengths[i - 1];
    const cur = answerLengths[i];
    if (prev > 0 && cur > prev * 2) {
      const between = events.filter((e) => {
        const t = new Date(e.created_at).getTime();
        return t >= answerLengths.times[i - 1] && t <= answerLengths.times[i];
      });
      if (between.some((e) => e.event_type === "paste")) {
        jump_flag = 1;
        break;
      }
    }
  }

  const blur_ratio = Math.min(1, blur / 12);
  return (paste_ratio + jump_flag + blur_ratio) / 3;
}

function computeIntegrityFromWorkEvents(events) {
  const paste = events.filter((e) => e.event_type === "paste").length;
  const firstInput = events.filter((e) => e.event_type === "first_input").length;
  const blur = events.filter((e) => e.event_type === "blur").length;
  const paste_ratio = paste / Math.max(1, paste + firstInput);

  let jump_flag = 0;
  let lastLen = 0;
  for (const ev of events) {
    if (ev.event_type === "draft" || ev.event_type === "submit") {
      let len = 0;
      try {
        const p = JSON.parse(ev.payload_json || "{}");
        len = String(p.length || p.text || "").length;
      } catch {
        len = 0;
      }
      if (lastLen > 0 && len > lastLen * 2) {
        const idx = events.indexOf(ev);
        const slice = events.slice(0, idx + 1);
        if (slice.some((e) => e.event_type === "paste")) {
          jump_flag = 1;
        }
      }
      lastLen = len;
    }
  }

  const blur_ratio = Math.min(1, blur / 12);
  return (paste_ratio + jump_flag + blur_ratio) / 3;
}

module.exports = { computeIntegrity, computeIntegrityFromWorkEvents };
