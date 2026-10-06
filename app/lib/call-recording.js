"use strict";

const fs = require("fs");
const path = require("path");
const { isWebmBuffer } = require("./webm");

/** Stub EBML-only uploads and corrupt headers are not "recordings". */
const MIN_PLAYABLE_RECORDING_BYTES = 4096;

function recordingFilePath(recordingPath, side) {
  if (!recordingPath || !side) return null;
  return path.join(recordingPath, `${side}.webm`);
}

function isPlayableRecordingFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const st = fs.statSync(filePath);
  if (st.size < MIN_PLAYABLE_RECORDING_BYTES) return false;
  const head = Buffer.alloc(4);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, head, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  return isWebmBuffer(head);
}

function listPlayableRecordingSides(recordingPath) {
  if (!recordingPath) return [];
  const sides = [];
  for (const side of ["candidate", "employer"]) {
    const fp = recordingFilePath(recordingPath, side);
    if (isPlayableRecordingFile(fp)) sides.push(side);
  }
  return sides;
}

function hasAnyPlayableRecording(recordingPath) {
  return listPlayableRecordingSides(recordingPath).length > 0;
}

module.exports = {
  MIN_PLAYABLE_RECORDING_BYTES,
  recordingFilePath,
  isPlayableRecordingFile,
  listPlayableRecordingSides,
  hasAnyPlayableRecording,
};
