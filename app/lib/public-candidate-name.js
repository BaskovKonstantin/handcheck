"use strict";

const FALLBACK_NAME = "Кандидат без имени";

function publicCandidateDisplayName(displayName) {
  const name = String(displayName ?? "").trim();
  return name || FALLBACK_NAME;
}

module.exports = { publicCandidateDisplayName, FALLBACK_NAME };
