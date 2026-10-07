"use strict";

/** Chromium keepalive fetch body limit (~64 KB); leave headroom for multipart overhead. */
const KEEPALIVE_BODY_LIMIT = 60 * 1024;
/** Max merged blob per upload so a multipart body fits in one keepalive request. */
const MAX_UPLOAD_BLOB_BYTES = 48 * 1024;
/** Auto-flush when queued recorder blobs exceed this (before the next timeslice). */
const MAX_PENDING_BLOB_BYTES = 48 * 1024;

function partSize(part) {
  return part?.size || 0;
}

function pendingBytes(parts) {
  return parts.reduce((sum, p) => sum + partSize(p), 0);
}

/**
 * Split recorder blobs into upload batches, each with total size ≤ maxBytes
 * (a single blob larger than maxBytes becomes its own batch).
 */
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

/**
 * Take the first upload batch from the front of `chunks` without copying the whole queue.
 */
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

module.exports = {
  KEEPALIVE_BODY_LIMIT,
  MAX_UPLOAD_BLOB_BYTES,
  MAX_PENDING_BLOB_BYTES,
  partSize,
  pendingBytes,
  splitPartsIntoUploadBatches,
  takeNextUploadBatch,
};
