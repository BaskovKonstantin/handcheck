"use strict";

function isWebmBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

function normalizeWebmMime(mime) {
  const base = String(mime || "").toLowerCase().split(";")[0].trim();
  return base;
}

function assertWebmUpload(file) {
  if (!file?.buffer?.length || !isWebmBuffer(file.buffer)) return false;
  const base = normalizeWebmMime(file.mimetype);
  if (base === "video/webm" || base === "audio/webm") return true;
  const generic = new Set(["application/octet-stream", "text/plain", "binary/octet-stream"]);
  return generic.has(base);
}

/** MediaRecorder continuation blobs may start with a cluster, not EBML. */
function isWebmClusterBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x1f && buf[1] === 0x43 && buf[2] === 0xb6 && buf[3] === 0x75;
}

/** Chromium VP9 mid-cluster continuations (e.g. 0x41 0xe3 0x81 …) are valid after the first chunk. */
const MIN_CONTINUATION_CHUNK_BYTES = 32;

function isWebmMediaContinuationBuffer(buf) {
  if (!buf || buf.length < MIN_CONTINUATION_CHUNK_BYTES) return false;
  if (isWebmBuffer(buf) || isWebmClusterBuffer(buf)) return true;
  return true;
}

function recordingChunkMimeOk(mimetype) {
  const base = normalizeWebmMime(mimetype);
  if (base === "video/webm" || base === "audio/webm") return true;
  const generic = new Set(["application/octet-stream", "text/plain", "binary/octet-stream"]);
  return generic.has(base);
}

function assertRecordingChunkUpload(file, hasExistingChunks) {
  if (!file?.buffer?.length) return false;
  if (assertWebmUpload(file)) return true;
  if (!hasExistingChunks || !recordingChunkMimeOk(file.mimetype)) return false;
  return isWebmMediaContinuationBuffer(file.buffer);
}

module.exports = {
  isWebmBuffer,
  isWebmClusterBuffer,
  isWebmMediaContinuationBuffer,
  MIN_CONTINUATION_CHUNK_BYTES,
  assertWebmUpload,
  assertRecordingChunkUpload,
  normalizeWebmMime,
};
