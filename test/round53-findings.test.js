"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const {
  KEEPALIVE_BODY_LIMIT,
  pendingBytes,
} = require("../app/lib/recording-chunk-policy");
const { createRecordingChunkQueue } = require("../app/lib/recording-chunk-queue");

function blob(size) {
  return { size, type: "video/webm" };
}

describe("round53 findings (unit)", () => {
  it("P2-1: no status-pill CSS rule sets text-transform", () => {
    const css = fs.readFileSync(path.join(__dirname, "../app/public/styles.css"), "utf8");
    const blocks = css.match(/\.status-pill[^{]*\{[^}]+\}/g) || [];
    assert.ok(blocks.length > 0, "expected .status-pill rules");
    for (const block of blocks) {
      assert.doesNotMatch(block, /text-transform:\s*lowercase/);
      assert.doesNotMatch(block, /text-transform:\s*uppercase/);
    }
  });

  it("P2-2: post-prune keeps previous tag with mixed id lengths", () => {
    const scriptPath = path.join(__dirname, "../bin/handcheck-deploy-disk.sh");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hc-compose-"));
    const rmiLog = path.join(tmp, "rmi.log");
    const pruneLog = path.join(tmp, "prune.log");
    const fullCurrent =
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const r = spawnSync("bash", [scriptPath, "post-prune"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(__dirname, "fixtures/fake-docker-bin")}:${process.env.PATH}`,
        HANDCHECK_COMPOSE_DIR: tmp,
        FAKE_DOCKER_CURRENT_ID: fullCurrent,
        FAKE_DOCKER_CURRENT_SHORT: "cccccccccccc",
        FAKE_DOCKER_PREV_ID: "bbbbbbbbbbbb",
        FAKE_DOCKER_OLD_ID: "aaaaaaaaaaaa",
        FAKE_DOCKER_RMI_LOG: rmiLog,
        FAKE_DOCKER_PRUNE_LOG: pruneLog,
      },
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /Keeping HandCheck images for rollback/);
    assert.match(r.stdout, /cccccccccccc/);
    assert.match(r.stdout, /bbbbbbbbbbbb/);
    const log = fs.existsSync(rmiLog) ? fs.readFileSync(rmiLog, "utf8") : "";
    assert.match(log, /aaaaaaaaaaaa/);
    assert.doesNotMatch(log, /cccccccccccc/);
    assert.doesNotMatch(log, /bbbbbbbbbbbb/);
    const prune = fs.existsSync(pruneLog) ? fs.readFileSync(pruneLog, "utf8") : "";
    assert.doesNotMatch(prune, /volume/);
    assert.doesNotMatch(prune, /system-prune/);
  });

  it("P2-2: tag-rollback mode tags latest as previous", () => {
    const scriptPath = path.join(__dirname, "../bin/handcheck-deploy-disk.sh");
    const r = spawnSync("bash", [scriptPath, "tag-rollback"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(__dirname, "fixtures/fake-docker-bin")}:${process.env.PATH}`,
      },
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /handcheck-web:previous/);
  });

  it("P2-3: emergency flush does not re-send in-flight batch", async () => {
    const emergencySizes = [];
    let resolveUpload;
    const queue = createRecordingChunkQueue({
      uploadBlob: () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    });
    queue.push(blob(5000));
    void queue.flush();
    for (let i = 0; i < 20 && !queue._testInFlight(); i += 1) {
      await new Promise((r) => setImmediate(r));
    }
    assert.ok(queue._testInFlight());
    queue.push(blob(3000));
    queue.emergencyFlushKeepalive((parts) => {
      emergencySizes.push(parts.map((p) => p.size));
    });
    assert.deepEqual(emergencySizes, [[3000]]);
    assert.ok(queue._testInFlight());
    resolveUpload();
    await queue.waitForIdle();
  });

  it("P2-3: second keepalive batch is re-queued while first is in flight", () => {
    const queue = createRecordingChunkQueue({
      uploadBlob: async () => {},
    });
    queue.push(blob(48_000));
    queue.push(blob(20_000));
    let keepaliveBytesInFlight = 0;
    const started = [];
    queue.emergencyFlushKeepalive((parts) => {
      const bytes = pendingBytes(parts);
      if (bytes > KEEPALIVE_BODY_LIMIT || keepaliveBytesInFlight + bytes > KEEPALIVE_BODY_LIMIT) {
        queue.requeueParts(parts);
        return;
      }
      keepaliveBytesInFlight += bytes;
      started.push(bytes);
    });
    assert.deepEqual(started, [48_000]);
    assert.equal(queue.pendingBlobBytes(), 20_000);
  });

  it("P2-3: call room keepalive upload catches failures and re-queues", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../app/public/call-room-webrtc.js"),
      "utf8"
    );
    assert.match(src, /keepaliveBytesInFlight \+= blob\.size/);
    assert.match(src, /\.catch\(\(\) => \{[\s\S]*keepaliveBytesInFlight -= blob\.size[\s\S]*requeueParts/);
    assert.match(src, /else chunkQueue\?\.requeueParts\?\.\(parts\)/);
  });
});
