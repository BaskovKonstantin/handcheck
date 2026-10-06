"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");
const { fixWebmDuration } = require("fix-webm-duration");
const { isWebmBuffer } = require("./webm");
const { MIN_PLAYABLE_RECORDING_BYTES, isPlayableRecordingFile } = require("./call-recording");

function callsRoot() {
  return path.resolve(config.CALLS_DIR);
}

function callDir(callId) {
  const root = callsRoot();
  const dir = path.resolve(root, callId);
  if (!dir.startsWith(root + path.sep) && dir !== root) {
    throw new Error("invalid_path");
  }
  return dir;
}

function chunkDir(callId, side) {
  const dir = path.join(callDir(callId), "chunks", side);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listChunkFiles(callId, side) {
  const dir = chunkDir(callId, side);
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.webm$/.test(f))
    .sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]))
    .map((f) => path.join(dir, f));
}

function appendChunk(callId, side, buffer) {
  const dir = chunkDir(callId, side);
  const existing = fs.readdirSync(dir).filter((f) => /^\d+\.webm$/.test(f));
  const next = existing.length ? Math.max(...existing.map((f) => Number(f.split(".")[0]))) + 1 : 1;
  const filePath = path.join(dir, `${String(next).padStart(5, "0")}.webm`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function normalizeChunkPart(buf, isFirst) {
  if (!buf?.length) return buf;
  if (isFirst) return buf;
  if (isWebmBuffer(buf)) {
    const cluster = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
    const at = buf.indexOf(cluster, 4);
    if (at > 0) return buf.subarray(at);
    return buf.subarray(4);
  }
  return buf;
}

function mergeBuffers(buffers) {
  const parts = buffers.filter((b) => b && b.length);
  if (!parts.length) return Buffer.alloc(0);
  return Buffer.concat(parts.map((b, i) => normalizeChunkPart(b, i === 0)));
}

function totalChunkBytes(callId, side) {
  return listChunkFiles(callId, side).reduce((sum, p) => sum + fs.statSync(p).size, 0);
}

function mergeChunksToFinal(callId, side, tailBuffer, durationMs) {
  const parts = listChunkFiles(callId, side).map((p) => fs.readFileSync(p));
  if (tailBuffer?.length) parts.push(tailBuffer);
  if (!parts.length) return null;
  let merged = mergeBuffers(parts);
  if (durationMs && Number.isFinite(durationMs) && durationMs > 0) {
    try {
      merged = Buffer.from(fixWebmDuration(merged, durationMs));
    } catch {
      /* keep merged without duration patch */
    }
  }
  const finalPath = path.join(callDir(callId), `${side}.webm`);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  if (merged.length < MIN_PLAYABLE_RECORDING_BYTES) return null;
  fs.writeFileSync(finalPath, merged);
  return finalPath;
}

function writeFinalRecording(callId, side, buffer, durationMs) {
  const parts = listChunkFiles(callId, side).map((p) => fs.readFileSync(p));
  if (buffer?.length) parts.push(buffer);
  if (!parts.length) return null;
  let merged = mergeBuffers(parts);
  if (durationMs && Number.isFinite(durationMs) && durationMs > 0) {
    try {
      merged = Buffer.from(fixWebmDuration(merged, durationMs));
    } catch {
      /* ignore */
    }
  }
  const finalPath = path.join(callDir(callId), `${side}.webm`);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  if (merged.length < MIN_PLAYABLE_RECORDING_BYTES) {
    if (fs.existsSync(finalPath) && !isPlayableRecordingFile(finalPath)) {
      try {
        fs.unlinkSync(finalPath);
      } catch {
        /* ignore */
      }
    }
    return null;
  }
  fs.writeFileSync(finalPath, merged);
  return finalPath;
}

function finalizeOrphanChunkSides(callId, durationMs) {
  const dir = callDir(callId);
  for (const side of ["candidate", "employer"]) {
    const chunks = listChunkFiles(callId, side);
    if (!chunks.length) continue;
    const finalPath = path.join(dir, `${side}.webm`);
    if (isPlayableRecordingFile(finalPath)) continue;
    mergeChunksToFinal(callId, side, Buffer.alloc(0), durationMs);
  }
}

module.exports = {
  callDir,
  appendChunk,
  mergeChunksToFinal,
  writeFinalRecording,
  listChunkFiles,
  totalChunkBytes,
  mergeBuffers,
  finalizeOrphanChunkSides,
};
