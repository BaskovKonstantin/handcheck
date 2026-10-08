"use strict";

/** HTTP statuses that often mean the upstream closed mid-request (Caddy EOF, etc.). */
const RETRYABLE_FINALIZE_STATUSES = new Set([502, 503, 504]);

const FINALIZE_MAX_ATTEMPTS = 5;
const FINALIZE_RETRY_BASE_MS = 600;
const FINALIZE_RETRY_MAX_MS = 8_000;

function isRetryableFinalizeStatus(status) {
  return RETRYABLE_FINALIZE_STATUSES.has(status);
}

function isRetryableFinalizeError(err) {
  return Boolean(err);
}

/**
 * After the first attempt included a tail blob, later attempts send duration-only first
 * so a successful merge before a 502 is not duplicated on retry.
 */
function shouldAttachTailOnFinalizeAttempt(attemptIndex, tailSize, tailSentOnPriorAttempt) {
  if (!tailSize) return false;
  if (attemptIndex === 0) return true;
  return !tailSentOnPriorAttempt;
}

function finalizeRetryDelayMs(attemptIndex) {
  const exp = Math.min(
    FINALIZE_RETRY_BASE_MS * 2 ** Math.max(0, attemptIndex - 1),
    FINALIZE_RETRY_MAX_MS
  );
  return exp;
}

function recordingFinalizeNeedsTailAgain(status, body, tailSentOnPriorAttempt) {
  if (!tailSentOnPriorAttempt) return false;
  if (status !== 400) return false;
  const code = body?.error;
  return code === "file_required" || code === "invalid_recording";
}

module.exports = {
  RETRYABLE_FINALIZE_STATUSES,
  FINALIZE_MAX_ATTEMPTS,
  FINALIZE_RETRY_BASE_MS,
  FINALIZE_RETRY_MAX_MS,
  isRetryableFinalizeStatus,
  isRetryableFinalizeError,
  shouldAttachTailOnFinalizeAttempt,
  finalizeRetryDelayMs,
  recordingFinalizeNeedsTailAgain,
};
