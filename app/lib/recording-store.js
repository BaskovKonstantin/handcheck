"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");
const { fixWebmDuration } = require("fix-webm-duration");

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

function mergeBuffers(buffers) {
  return Buffer.concat(buffers.filter((b) => b && b.length));
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
  fs.writeFileSync(finalPath, merged);
  return finalPath;
}

module.exports = {
  callDir,
  appendChunk,
  mergeChunksToFinal,
  writeFinalRecording,
  listChunkFiles,
};
