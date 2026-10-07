"use strict";

/**
 * Serialises MediaRecorder blob flushes so blobs that arrive during upload are kept
 * and each blob is uploaded exactly once.
 */
function createRecordingChunkQueue({ uploadBlob }) {
  let chunks = [];
  let flushChain = Promise.resolve();

  function push(blob) {
    if (blob?.size) chunks.push(blob);
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

  async function flushOnce() {
    const snap = snapshotPending();
    if (!snap) return false;
    await uploadBlob(snap.pending);
    commitUploaded(snap.count);
    return true;
  }

  function flush() {
    flushChain = flushChain.then(async () => {
      while (await flushOnce()) {
        /* drain queue */
      }
    });
    return flushChain;
  }

  function drainRemainingBlobs(mimeType) {
    if (!chunks.length) return null;
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    chunks = [];
    return blob.size ? blob : null;
  }

  function pendingCount() {
    return chunks.length;
  }

  return {
    push,
    flush,
    waitForIdle: () => flushChain,
    drainRemainingBlobs,
    pendingCount,
    _testChunks: () => chunks,
  };
}

module.exports = { createRecordingChunkQueue };
