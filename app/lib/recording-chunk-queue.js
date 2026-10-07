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
}) {
  let chunks = [];
  let flushChain = Promise.resolve();
  let flushGeneration = 0;
  /** @type {{ pending: unknown[], count: number } | null} */
  let inFlight = null;
  function push(blob) {
    if (blob?.size) chunks.push(blob);
    if (pendingBlobBytes() >= maxPendingBytes) {
      flush();
    }
  }

  function snapshotPending() {
    if (!chunks.length) return null;
    const pending = chunks.slice();
    const count = pending.length;
    return { pending, count };
  }

  function commitUploaded(count) {
    if (count > 0) chunks.splice(0, count);
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
    if (inFlight) return chunks.length > 0;
    const snap = takeNextUploadBatch(chunks, maxUploadBytes);
    if (!snap) return false;
    const gen = flushGeneration;
    inFlight = snap;
    try {
      await uploadBlob(snap.pending);
      if (gen === flushGeneration) {
        inFlight = null;
      }
      return chunks.length > 0 || inFlight != null;
    } catch (err) {
      if (gen === flushGeneration) {
        chunks.unshift(...snap.pending);
        inFlight = null;
      }
      throw err;
    }
  }

  function flush() {
    flushChain = flushChain.then(async () => {
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
    waitForIdle: () => flushChain,
    emergencyFlushKeepalive,
    requeueParts,
    drainRemainingBlobs,
    pendingCount,
    pendingBlobBytes,
    _testChunks: () => chunks,
    _testInFlight: () => inFlight,
  };
}

module.exports = { createRecordingChunkQueue };
