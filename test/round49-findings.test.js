"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const {
  MAX_PENDING_BLOB_BYTES,
  MAX_UPLOAD_BLOB_BYTES,
  KEEPALIVE_BODY_LIMIT,
  pendingBytes,
  splitPartsIntoUploadBatches,
} = require("../app/lib/recording-chunk-policy");
const { createRecordingChunkQueue } = require("../app/lib/recording-chunk-queue");

function blob(size) {
  return { size, type: "video/webm" };
}

describe("round49 findings (unit)", () => {
  it("P1-1: upload batches stay within keepalive blob budget", () => {
    const parts = [];
    for (let i = 0; i < 40; i += 1) parts.push(blob(4000));
    const batches = splitPartsIntoUploadBatches(parts);
    assert.ok(batches.length > 1);
    for (const batch of batches) {
      assert.ok(pendingBytes(batch) <= MAX_UPLOAD_BLOB_BYTES);
      assert.ok(pendingBytes(batch) <= KEEPALIVE_BODY_LIMIT);
    }
  });

  it("P1-1: pending bytes stay capped via auto-flush", async () => {
    let maxSeen = 0;
    const queue = createRecordingChunkQueue({
      uploadBlob: async () => {},
    });
    for (let i = 0; i < 24; i += 1) {
      queue.push(blob(4000));
      maxSeen = Math.max(maxSeen, queue.pendingBlobBytes());
      await queue.waitForIdle();
    }
    assert.ok(maxSeen <= KEEPALIVE_BODY_LIMIT, `max pending ${maxSeen}`);
  });

  it("P1-1: emergency flush uploads all pending batches in order", () => {
    const uploaded = [];
    const queue = createRecordingChunkQueue({
      uploadBlob: async (parts) => {
        uploaded.push(parts.map((p) => p.size));
      },
    });
    for (let i = 0; i < 8; i += 1) queue.push(blob(7000));
    const batches = queue.emergencyFlushKeepalive((parts) => {
      uploaded.push(parts.map((p) => p.size));
    });
    assert.ok(batches.length >= 1);
    assert.equal(queue.pendingBlobBytes(), 0);
    const flat = uploaded.flat();
    assert.equal(flat.length, 8);
    assert.deepEqual(flat, Array(8).fill(7000));
  });

  it("P1-1: call room uses emergency keepalive flush on pagehide", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(src, /emergencyFlushKeepalive/);
    assert.match(src, /CHUNK_UPLOAD_MS = 3_000/);
    assert.doesNotMatch(src, /void flushRecordingChunks\(\)\s*\n\s*\.then\(\(\) => \{\s*\n\s*const tail = chunkQueue/);
  });

  it("P2-1: status pills are not forced lowercase in CSS", () => {
    const css = fs.readFileSync(path.join(__dirname, "../app/public/styles.css"), "utf8");
    const blocks = css.match(/\.status-pill[^{]*\{[^}]+\}/g) || [];
    for (const block of blocks) {
      assert.doesNotMatch(block, /text-transform:\s*lowercase/);
    }
  });
});
