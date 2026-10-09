"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { isWebmBuffer } = require("./webm");
const {
  ffmpegAvailable,
  concatSessionWebmBuffers,
  remuxWebmBuffer,
  readDurationSecondsFromBuffer,
  patchWebmDurationHint,
} = require("./webm-ffmpeg");
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

function groupChunkBuffersIntoSessions(buffers) {
  const sessions = [];
  let current = [];
  for (const buf of buffers) {
    if (!buf?.length) continue;
    if (isWebmBuffer(buf) && current.length > 0) {
      sessions.push(mergeBuffers(current));
      current = [buf];
    } else {
      current.push(buf);
    }
  }
  if (current.length) sessions.push(mergeBuffers(current));
  return sessions;
}

function finalizeMergedWebm(buffers, durationMs) {
  const parts = buffers.filter((b) => b && b.length);
  if (!parts.length) return null;
  const sessions = groupChunkBuffersIntoSessions(parts);
  if (
    ffmpegAvailable() &&
    sessions.length > 0 &&
    sessions.every((s) => isWebmBuffer(s) && s.length >= 1024)
  ) {
    try {
      let merged =
        sessions.length === 1 ? remuxWebmBuffer(sessions[0]) : concatSessionWebmBuffers(sessions);
      if (merged?.length) {
        merged = remuxWebmBuffer(merged);
        if (merged.length >= MIN_PLAYABLE_RECORDING_BYTES) {
          const probed = readDurationSecondsFromBuffer(merged);
          if (!probed || probed <= 0) {
            merged = patchWebmDurationHint(merged, durationMs);
          }
          const after = readDurationSecondsFromBuffer(merged);
          if ((after && after > 0) || merged.length >= MIN_PLAYABLE_RECORDING_BYTES) {
            return merged;
          }
        }
      }
    } catch {
      /* invalid WebM fixture or ffmpeg error — fall back to byte merge */
    }
  }
  const merged = mergeBuffers(parts);
  return merged?.length ? merged : null;
}

function totalChunkBytes(callId, side) {
  return listChunkFiles(callId, side).reduce((sum, p) => sum + fs.statSync(p).size, 0);
}

function clearChunkFiles(callId, side) {
  for (const chunkPath of listChunkFiles(callId, side)) {
    try {
      fs.unlinkSync(chunkPath);
    } catch {
      /* ignore */
    }
  }
}

function tailMarkerPath(callId, side) {
  return path.join(callDir(callId), `${side}.finalize-tail.sha256`);
}

function tailSha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function wasTailAlreadyMerged(callId, side, buffer) {
  if (!buffer?.length) return false;
  try {
    const markerPath = tailMarkerPath(callId, side);
    if (!fs.existsSync(markerPath)) return false;
    return fs.readFileSync(markerPath, "utf8").trim() === tailSha256(buffer);
  } catch {
    return false;
  }
}

function recordMergedTail(callId, side, buffer) {
  if (!buffer?.length) return;
  fs.writeFileSync(tailMarkerPath(callId, side), tailSha256(buffer), "utf8");
}

function mergeChunksToFinal(callId, side, tailBuffer, durationMs) {
  const finalPath = path.join(callDir(callId), `${side}.webm`);
  const hasTail = Boolean(tailBuffer?.length);
  const chunkPaths = listChunkFiles(callId, side);
  if (!hasTail && isPlayableRecordingFile(finalPath) && chunkPaths.length === 0) {
    return finalPath;
  }
  const parts = chunkPaths.map((p) => fs.readFileSync(p));
  if (tailBuffer?.length) parts.push(tailBuffer);
  if (!parts.length) {
    if (isPlayableRecordingFile(finalPath)) return finalPath;
    return null;
  }
  const merged = finalizeMergedWebm(parts, durationMs);
  if (!merged) return null;
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  if (merged.length < MIN_PLAYABLE_RECORDING_BYTES) return null;
  fs.writeFileSync(finalPath, merged);
  clearChunkFiles(callId, side);
  return finalPath;
}

function hasRecordingContinuationContext(callId, side) {
  if (listChunkFiles(callId, side).length > 0) return true;
  const finalPath = path.join(callDir(callId), `${side}.webm`);
  return isPlayableRecordingFile(finalPath);
}

function writeFinalRecording(callId, side, buffer, durationMs) {
  const finalPath = path.join(callDir(callId), `${side}.webm`);
  const hasTail = Boolean(buffer?.length);
  const chunkPaths = listChunkFiles(callId, side);
  const playable = isPlayableRecordingFile(finalPath);

  if (!hasTail && playable && chunkPaths.length === 0) {
    return finalPath;
  }

  if (hasTail && playable && chunkPaths.length === 0) {
    if (wasTailAlreadyMerged(callId, side, buffer)) {
      return finalPath;
    }
    const prev = fs.readFileSync(finalPath);
    const merged = finalizeMergedWebm([prev, buffer], durationMs);
    if (!merged || merged.length < MIN_PLAYABLE_RECORDING_BYTES) {
      return playable ? finalPath : null;
    }
    if (merged.length <= prev.length) {
      return finalPath;
    }
    fs.writeFileSync(finalPath, merged);
    recordMergedTail(callId, side, buffer);
    clearChunkFiles(callId, side);
    return finalPath;
  }

  let parts;
  if (chunkPaths.length > 0 && playable) {
    parts = [fs.readFileSync(finalPath), ...chunkPaths.map((p) => fs.readFileSync(p))];
  } else {
    parts = chunkPaths.map((p) => fs.readFileSync(p));
  }
  if (buffer?.length) parts.push(buffer);
  if (!parts.length) {
    if (playable) return finalPath;
    return null;
  }
  const merged = finalizeMergedWebm(parts, durationMs);
  if (!merged) return null;
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
  if (buffer?.length) recordMergedTail(callId, side, buffer);
  clearChunkFiles(callId, side);
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
  hasRecordingContinuationContext,
  listChunkFiles,
  totalChunkBytes,
  mergeBuffers,
  groupChunkBuffersIntoSessions,
  finalizeMergedWebm,
  finalizeOrphanChunkSides,
};
