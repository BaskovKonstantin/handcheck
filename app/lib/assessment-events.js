"use strict";

const ALLOWED_EVENT_TYPES = new Set([
  "focus",
  "blur",
  "first_input",
  "typing",
  "paste",
  "draft",
]);

const MAX_PAYLOAD_BYTES = 2048;
const MAX_EVENTS_PER_REQUEST = 32;

function validateClientEvent(ev) {
  const eventType = String(ev?.event_type || "").trim();
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return { ok: false, code: "invalid_event", message: "Недопустимый тип события" };
  }
  let payloadJson = null;
  if (ev.payload != null) {
    try {
      payloadJson = JSON.stringify(ev.payload);
    } catch {
      return { ok: false, code: "invalid_event", message: "Некорректные данные события" };
    }
    if (payloadJson.length > MAX_PAYLOAD_BYTES) {
      return { ok: false, code: "payload_too_large", message: "Слишком большой payload события" };
    }
  }
  return { ok: true, eventType, payloadJson };
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  MAX_PAYLOAD_BYTES,
  MAX_EVENTS_PER_REQUEST,
  validateClientEvent,
};
