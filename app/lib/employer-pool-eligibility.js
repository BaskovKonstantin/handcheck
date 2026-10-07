"use strict";

const { sanitizeStoredDisplayName } = require("./public-candidate-name");

function parseStackJson(stackJson) {
  try {
    const parsed = JSON.parse(stackJson || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => String(s).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Employer matching pool: confirmed email plus a minimal public profile
 * (display name after sanitization, or non-empty stack).
 */
function isEligibleForEmployerPool(row) {
  if (!row?.email_confirmed_at) return false;
  const displayName = sanitizeStoredDisplayName(row.display_name, row.email);
  if (displayName) return true;
  return parseStackJson(row.stack_json).length > 0;
}

module.exports = {
  isEligibleForEmployerPool,
  parseStackJson,
};
