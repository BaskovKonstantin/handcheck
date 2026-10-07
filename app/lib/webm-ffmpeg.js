"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

let ffmpegChecked = false;
let ffmpegOk = false;

function ffmpegAvailable() {
  if (ffmpegChecked) return ffmpegOk;
  ffmpegChecked = true;
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  ffmpegOk = r.status === 0;
  return ffmpegOk;
}

function runFfmpeg(args, { input, timeoutMs = 20_000 } = {}) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    encoding: "buffer",
    input: input || undefined,
    maxBuffer: 120 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (r.status !== 0) {
    const err = (r.stderr || Buffer.alloc(0)).toString("utf8").slice(0, 2000);
    throw new Error(`ffmpeg_failed: ${err || r.status}`);
  }
  return r.stdout;
}

function ffprobeDurationSeconds(filePath) {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8", timeout: 10_000 }
  );
  if (r.status !== 0) return null;
  const n = Number(String(r.stdout || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function writeTempWebm(buffer, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || "hc-webm-"));
  const filePath = path.join(dir, "in.webm");
  fs.writeFileSync(filePath, buffer);
  return { dir, filePath };
}

/** Map video before audio so concat across sessions keeps codec alignment. */
function remuxWebmFile(inputPath, outputPath) {
  runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    outputPath,
  ]);
}

function remuxWebmBuffer(buffer) {
  if (!buffer?.length) return buffer;
  if (!ffmpegAvailable()) return buffer;
  const { dir, filePath } = writeTempWebm(buffer, "hc-remux-");
  const outPath = path.join(dir, "out.webm");
  try {
    remuxWebmFile(filePath, outPath);
    return fs.readFileSync(outPath);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function concatTwoSessionWebmBuffers(leftBuffer, rightBuffer) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hc-sess2-"));
  try {
    const leftRaw = path.join(tmpRoot, "left.webm");
    const leftRemux = path.join(tmpRoot, "left-r.webm");
    fs.writeFileSync(leftRaw, leftBuffer);
    remuxWebmFile(leftRaw, leftRemux);
    const offsetSec = ffprobeDurationSeconds(leftRemux) || 0;

    const rightRaw = path.join(tmpRoot, "right.webm");
    const rightRemux = path.join(tmpRoot, "right-r.webm");
    fs.writeFileSync(rightRaw, rightBuffer);
    remuxWebmFile(rightRaw, rightRemux);
    const rightShift = path.join(tmpRoot, "right-s.webm");
    if (offsetSec > 0) {
      runFfmpeg([
        "-y",
        "-i",
        rightRemux,
        "-c",
        "copy",
        "-map",
        "0",
        "-output_ts_offset",
        String(offsetSec),
        rightShift,
      ]);
    } else {
      fs.copyFileSync(rightRemux, rightShift);
    }

    const listPath = path.join(tmpRoot, "list.txt");
    const listBody = [leftRemux, rightShift]
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n");
    fs.writeFileSync(listPath, listBody);
    const finalPath = path.join(tmpRoot, "final.webm");
    runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", finalPath]);
    return fs.readFileSync(finalPath);
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function concatSessionWebmBuffers(sessionBuffers) {
  if (!sessionBuffers.length) return Buffer.alloc(0);
  if (sessionBuffers.length === 1) return remuxWebmBuffer(sessionBuffers[0]);
  if (!ffmpegAvailable()) {
    return remuxWebmBuffer(Buffer.concat(sessionBuffers));
  }
  let acc = remuxWebmBuffer(sessionBuffers[0]);
  for (let i = 1; i < sessionBuffers.length; i += 1) {
    acc = concatTwoSessionWebmBuffers(acc, sessionBuffers[i]);
  }
  return acc;
}

function patchWebmDurationHint(buffer, durationMs) {
  if (!buffer?.length || !durationMs || !ffmpegAvailable()) return buffer;
  const sec = Math.max(0.5, durationMs / 1000);
  const { dir, filePath } = writeTempWebm(buffer, "hc-dur-");
  const outPath = path.join(dir, "out.webm");
  try {
    runFfmpeg(["-y", "-i", filePath, "-c", "copy", "-t", String(sec), outPath]);
    return fs.readFileSync(outPath);
  } catch {
    return buffer;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function maxPacketGapSeconds(filePath, maxGap = 0.5) {
  const streams = ["v:0", "a:0"];
  let worst = 0;
  for (const stream of streams) {
    const r = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        stream,
        "-show_packets",
        "-show_entries",
        "packet=pts_time",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 80 * 1024 * 1024 }
    );
    if (r.status !== 0) continue;
    const times = String(r.stdout || "")
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((n) => Number.isFinite(n));
    for (let i = 1; i < times.length; i += 1) {
      const gap = times[i] - times[i - 1];
      if (gap > worst) worst = gap;
    }
  }
  return worst;
}

function decodeWebmClean(filePath) {
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-f", "null", "-"],
    { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }
  );
  return r.status === 0;
}

function readDurationSecondsFromBuffer(buffer) {
  if (!buffer?.length || !ffmpegAvailable()) return null;
  const { dir, filePath } = writeTempWebm(buffer, "hc-probe-");
  try {
    return ffprobeDurationSeconds(filePath);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  ffmpegAvailable,
  runFfmpeg,
  ffprobeDurationSeconds,
  remuxWebmBuffer,
  remuxWebmFile,
  concatSessionWebmBuffers,
  readDurationSecondsFromBuffer,
  patchWebmDurationHint,
  maxPacketGapSeconds,
  decodeWebmClean,
  concatTwoSessionWebmBuffers,
};
