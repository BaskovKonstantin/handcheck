"use strict";

const FALLBACK_NAME = "Кандидат без имени";

function emailLocalPart(email) {
  const s = String(email || "").trim().toLowerCase();
  const at = s.indexOf("@");
  return at > 0 ? s.slice(0, at) : "";
}

/** Treat auto-seeded email prefix as empty for privacy. */
function sanitizeStoredDisplayName(displayName, email) {
  const name = String(displayName ?? "").trim();
  const prefix = emailLocalPart(email);
  if (prefix && name.toLowerCase() === prefix) return "";
  return name;
}

function publicCandidateDisplayName(displayName, email) {
  const name = sanitizeStoredDisplayName(displayName, email);
  return name || FALLBACK_NAME;
}

module.exports = {
  publicCandidateDisplayName,
  sanitizeStoredDisplayName,
  emailLocalPart,
  FALLBACK_NAME,
};
