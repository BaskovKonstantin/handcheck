"use strict";

function isWebmBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

function assertWebmUpload(file) {
  if (!file?.buffer?.length) return false;
  const mime = String(file.mimetype || "").toLowerCase();
  const mimeOk = mime === "video/webm" || mime === "audio/webm";
  return mimeOk && isWebmBuffer(file.buffer);
}

module.exports = { isWebmBuffer, assertWebmUpload };
