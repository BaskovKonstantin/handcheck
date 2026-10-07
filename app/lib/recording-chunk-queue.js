"use strict";

const {
  MAX_PENDING_BLOB_BYTES,
  MAX_UPLOAD_BLOB_BYTES,
  pendingBytes,
  splitPartsIntoUploadBatches,
  takeNextUploadBatch,
} = require("./recording-chunk-policy");

/**
 * Serialises MediaRecorder blob flushes so blobs that arrive during upload are kept
 * and each blob is uploaded exactly once.
 */
function createRecordingChunkQueue({
  uploadBlob,
  maxUploadBytes = MAX_UPLOAD_BLOB_BYTES,
  maxPendingBytes = MAX_PENDING_BLOB_BYTES,
  onUploadFailure,
  onUploadSuccess,
  retryBaseMs = 1000,
  retryMaxMs = 30_000,
}) {
  let chunks = [];
  let flushChain = Promise.resolve();
  let flushGeneration = 0;
  /** @type {{ pending: unknown[], count: number } | null} */
  let inFlight = null;
  let retryTimer = null;
  let retryDelayMs = retryBaseMs;
  let uploadFailureActive = false;

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetryFlush() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush().catch(() => {});
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, retryMaxMs);
  }

  function notifyUploadSuccess() {
    retryDelayMs = retryBaseMs;
    if (uploadFailureActive) {
      uploadFailureActive = false;
      if (typeof onUploadSuccess === "function") onUploadSuccess();
    }
  }

  function notifyUploadFailure() {
    if (!uploadFailureActive) {
      uploadFailureActive = true;
      if (typeof onUploadFailure === "function") onUploadFailure();
    }
    scheduleRetryFlush();
  }

  function push(blob) {
    if (blob?.size) chunks.push(blob);
    if (pendingBlobBytes() >= maxPendingBytes) {
      void flush().catch(() => {});
    }
  }

  function collectQueuedPartsOnly() {
    const parts = chunks.slice();
    chunks = [];
    return parts;
  }

  function requeueParts(parts) {
    if (!parts?.length) return;
    chunks.unshift(...parts);
  }

  function collectAllPendingParts() {
    const parts = [];
    if (inFlight?.pending?.length) parts.push(...inFlight.pending);
    if (chunks.length) parts.push(...chunks);
    chunks = [];
    inFlight = null;
    return parts;
  }

  async function flushOnce() {
    if (inFlight) return false;
    const snap = takeNextUploadBatch(chunks, maxUploadBytes);
    if (!snap) return false;
    const gen = flushGeneration;
    inFlight = { pending: snap.pending, count: snap.count, gen };
    try {
      await uploadBlob(snap.pending);
      if (inFlight?.gen === gen) {
        inFlight = null;
      }
      notifyUploadSuccess();
      return chunks.length > 0;
    } catch (err) {
      if (inFlight?.gen === gen) {
        chunks.unshift(...snap.pending);
        inFlight = null;
      }
      notifyUploadFailure();
      return false;
    }
  }

  function flush() {
    flushChain = flushChain.catch(() => {}).then(async () => {
      while (await flushOnce()) {
        /* drain queue */
      }
    });
    return flushChain;
  }

  /**
   * Fire keepalive-sized uploads synchronously (pagehide). Aborts in-flight async commits.
   */
  function emergencyFlushKeepalive(uploadBatch) {
    flushGeneration += 1;
    inFlight = null;
    clearRetryTimer();
    const parts = collectQueuedPartsOnly();
    if (!parts.length) return [];
    const batches = splitPartsIntoUploadBatches(parts, maxUploadBytes);
    for (const batch of batches) {
      uploadBatch(batch);
    }
    return batches;
  }

  function drainRemainingBlobs(mimeType) {
    const parts = collectAllPendingParts();
    if (!parts.length) return null;
    const blob = new Blob(parts, { type: mimeType || "video/webm" });
    return blob.size ? blob : null;
  }

  function pendingCount() {
    return chunks.length + (inFlight ? inFlight.count : 0);
  }

  function pendingBlobBytes() {
    let total = pendingBytes(chunks);
    if (inFlight?.pending) total += pendingBytes(inFlight.pending);
    return total;
  }

  return {
    push,
    flush,
    waitForIdle: (timeoutMs = 90_000) => {
      if (!timeoutMs) return flushChain;
      return Promise.race([
        flushChain,
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("recording_chunk_queue_idle_timeout")),
            timeoutMs
          );
        }),
      ]);
    },
    emergencyFlushKeepalive,
    requeueParts,
    drainRemainingBlobs,
    pendingCount,
    pendingBlobBytes,
    _testChunks: () => chunks,
    _testInFlight: () => inFlight,
    _testUploadFailureActive: () => uploadFailureActive,
    _testClearRetry: () => clearRetryTimer(),
  };
}

module.exports = { createRecordingChunkQueue };
