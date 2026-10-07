/* global window */
"use strict";

(function (global) {
  const MAX_UPLOAD_BLOB_BYTES = 48 * 1024;
  const MAX_PENDING_BLOB_BYTES = 48 * 1024;

  function partSize(part) {
    return part?.size || 0;
  }

  function pendingBytes(parts) {
    return parts.reduce((sum, p) => sum + partSize(p), 0);
  }

  function splitPartsIntoUploadBatches(parts, maxBytes = MAX_UPLOAD_BLOB_BYTES) {
    if (!parts?.length) return [];
    const batches = [];
    let batch = [];
    let total = 0;
    for (const part of parts) {
      const sz = partSize(part);
      if (!batch.length) {
        batch.push(part);
        total = sz;
        if (total >= maxBytes) {
          batches.push(batch);
          batch = [];
          total = 0;
        }
        continue;
      }
      if (total + sz > maxBytes) {
        batches.push(batch);
        batch = [part];
        total = sz;
        if (total >= maxBytes) {
          batches.push(batch);
          batch = [];
          total = 0;
        }
        continue;
      }
      batch.push(part);
      total += sz;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  function takeNextUploadBatch(chunks, maxBytes = MAX_UPLOAD_BLOB_BYTES) {
    if (!chunks.length) return null;
    const pending = [];
    let total = 0;
    while (chunks.length) {
      const next = chunks[0];
      const sz = partSize(next);
      if (pending.length && total + sz > maxBytes) break;
      pending.push(chunks.shift());
      total += sz;
      if (total >= maxBytes) break;
    }
    if (!pending.length) return null;
    return { pending, count: pending.length, bytes: total };
  }

  function createRecordingChunkQueue({
    uploadBlob,
    maxUploadBytes = MAX_UPLOAD_BLOB_BYTES,
    maxPendingBytes = MAX_PENDING_BLOB_BYTES,
  }) {
    let chunks = [];
    let flushChain = Promise.resolve();
    let flushGeneration = 0;
    let inFlight = null;
    function push(blob) {
      if (blob?.size) chunks.push(blob);
      if (pendingBlobBytes() >= maxPendingBytes) {
        flush();
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
        return chunks.length > 0;
      } catch (err) {
        if (inFlight?.gen === gen) {
          chunks.unshift(...snap.pending);
          inFlight = null;
        }
        throw err;
      }
    }

    function flush() {
      flushChain = flushChain.then(async () => {
        while (await flushOnce()) {
          /* drain */
        }
      });
      return flushChain;
    }

    function emergencyFlushKeepalive(uploadBatch) {
      flushGeneration += 1;
      inFlight = null;
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
    };
  }

  global.HandCheckRecordingChunkQueue = {
    createRecordingChunkQueue,
    MAX_UPLOAD_BLOB_BYTES,
    MAX_PENDING_BLOB_BYTES,
  };
})(window);
