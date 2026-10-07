"use strict";

function parseEventPayload(ev) {
  try {
    return JSON.parse(ev?.payload_json || "{}");
  } catch {
    return {};
  }
}

function sumEventChars(events, eventType) {
  let total = 0;
  for (const ev of events) {
    if (ev.event_type !== eventType) continue;
    const p = parseEventPayload(ev);
    const n = Number(p.chars ?? p.length ?? 0);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

function answerLengthFromEvents(events) {
  let len = 0;
  for (const ev of events) {
    if (ev.event_type !== "draft" && ev.event_type !== "submit") continue;
    const p = parseEventPayload(ev);
    const n = Number(p.length);
    if (Number.isFinite(n)) len = Math.max(len, n);
    else if (p.text != null) len = Math.max(len, String(p.text).length);
  }
  return len;
}

function computeJumpFlag(events) {
  let jump_flag = 0;
  let lastLen = 0;
  for (const ev of events) {
    if (ev.event_type !== "draft" && ev.event_type !== "submit") continue;
    const p = parseEventPayload(ev);
    const len = Number(p.length ?? String(p.text || "").length) || 0;
    if (lastLen > 0 && len > lastLen * 2) {
      const idx = events.indexOf(ev);
      const slice = events.slice(0, idx + 1);
      if (slice.some((e) => e.event_type === "paste")) {
        jump_flag = 1;
      }
    }
    lastLen = len;
  }
  return jump_flag;
}

function computeBlurRatio(events) {
  const blur = events.filter((e) => e.event_type === "blur").length;
  return Math.min(1, blur / 12);
}

/**
 * Per-attempt integrity metrics and 0..1 suspicion score (higher = more paste/unattributed/speed risk).
 * @param {object[]} events attempt_events rows
 * @param {object} attempt { answer_text, opened_at, submitted_at, action_source, timed_out }
 */
function computeAttemptIntegrity(events, attempt = {}) {
  const answerLen = Math.max(
    String(attempt.answer_text || "").length,
    answerLengthFromEvents(events)
  );
  const actionSource = attempt.action_source || "web";
  const timedOut = Number(attempt.timed_out) === 1;

  const typedChars = sumEventChars(events, "typing");
  const pastedChars = sumEventChars(events, "paste");
  const otherChars = sumEventChars(events, "other_insert");

  let unattributedChars = Math.max(0, answerLen - typedChars - pastedChars - otherChars);

  const openedMs = attempt.opened_at ? new Date(attempt.opened_at).getTime() : NaN;
  const submittedMs = attempt.submitted_at ? new Date(attempt.submitted_at).getTime() : NaN;
  let openToSubmitSec = 0;
  if (Number.isFinite(openedMs) && Number.isFinite(submittedMs) && submittedMs >= openedMs) {
    openToSubmitSec = (submittedMs - openedMs) / 1000;
  }
  const charsPerSec =
    openToSubmitSec > 0 ? answerLen / openToSubmitSec : answerLen > 0 ? answerLen : 0;

  const metrics = {
    typedChars,
    pastedChars,
    otherInsertedChars: otherChars,
    unattributedChars,
    answerLength: answerLen,
    openToSubmitSec,
    charsPerSec,
    actionSource,
  };

  if (timedOut && answerLen === 0) {
    return { integrity: 0, metrics: { ...metrics, unattributedChars: 0 } };
  }

  if (actionSource === "mcp") {
    metrics.unattributedChars = 0;
    const paste_char_ratio = Math.min(1, pastedChars / Math.max(1, answerLen));
    const jump_flag = computeJumpFlag(events);
    const blur_ratio = computeBlurRatio(events);
    const integrity = Math.max(paste_char_ratio, (paste_char_ratio + jump_flag + blur_ratio) / 3);
    return { integrity, metrics };
  }

  const denom = Math.max(1, answerLen);
  const paste_char_ratio = Math.min(1, pastedChars / denom);
  const other_char_ratio = Math.min(1, otherChars / denom);
  const unattributed_ratio = Math.min(1, unattributedChars / denom);

  let speed_ratio = 0;
  if (unattributedChars > 0 && answerLen >= 40) {
    if (openToSubmitSec <= 0) {
      speed_ratio = 1;
    } else {
      const cps = charsPerSec;
      if (cps > 20) {
        speed_ratio = Math.min(1, (cps - 20) / 30);
      }
    }
  }

  const content_risk = Math.max(
    paste_char_ratio,
    other_char_ratio,
    unattributed_ratio,
    speed_ratio
  );
  const jump_flag = computeJumpFlag(events);
  const blur_ratio = computeBlurRatio(events);
  const legacy_blend = (paste_char_ratio + jump_flag + blur_ratio) / 3;
  const integrity = Math.max(content_risk, legacy_blend);

  return { integrity, metrics };
}

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

function computeIntegrityFromWorkEvents(events, attempt) {
  if (attempt && typeof attempt === "object") {
    return computeAttemptIntegrity(events, attempt).integrity;
  }
  const { integrity } = computeAttemptIntegrity(events, {
    answer_text: "",
    action_source: "web",
  });
  return integrity;
}

module.exports = {
  computeIntegrity,
  computeIntegrityFromWorkEvents,
  computeAttemptIntegrity,
  sumEventChars,
};
