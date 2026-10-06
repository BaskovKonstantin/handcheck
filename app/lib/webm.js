"use strict";

function isWebmBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

function normalizeWebmMime(mime) {
  const base = String(mime || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  return base;
}

function isWebmMime(mime) {
  const base = normalizeWebmMime(mime);
  return base === "video/webm" || base === "audio/webm";
}

function assertWebmUpload(file) {
  if (!file?.buffer?.length || !isWebmBuffer(file.buffer)) return false;
  const mime = String(file.mimetype || "").toLowerCase();
  if (isWebmMime(mime)) return true;
  // Some multipart parsers mislabel `video/webm;codecs=…` as text/plain or octet-stream.
  const loose = mime === "application/octet-stream" || mime === "text/plain" || mime === "";
  return loose;
}

module.exports = { isWebmBuffer, assertWebmUpload, isWebmMime, normalizeWebmMime };
