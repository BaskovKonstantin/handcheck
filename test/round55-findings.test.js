"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createRecordingChunkQueue } = require("../app/lib/recording-chunk-queue");
const { classifyLengthIncrease } = require("../app/lib/assessment-input-classify");
const { computeAttemptIntegrity } = require("../app/lib/integrity");

function blob(size) {
  return { size, type: "video/webm" };
}

function ev(type, payload) {
  return { event_type: type, payload_json: JSON.stringify(payload || {}) };
}

describe("round55 P2-1 recording chunk queue", () => {
  it("recovers after one failed upload: no unhandled rejection, retry uploads in order", async () => {
    const uploads = [];
    let rejectNext = true;
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    const queue = createRecordingChunkQueue({
      retryBaseMs: 5,
      retryMaxMs: 20,
      uploadBlob: async (parts) => {
        uploads.push(parts.map((p) => p.size));
        if (rejectNext) {
          rejectNext = false;
          throw new Error("Failed to fetch");
        }
      },
    });

    for (let i = 1; i <= 3; i += 1) queue.push(blob(i * 1000));

    await queue.flush();
    await new Promise((r) => setTimeout(r, 40));
    await queue.waitForIdle(5000);

    process.off("unhandledRejection", onUnhandled);
    assert.equal(unhandled.length, 0, `unhandled: ${unhandled}`);
    assert.ok(uploads.length >= 2, `upload calls: ${uploads.length}`);
    assert.deepEqual(uploads[uploads.length - 1], [1000, 2000, 3000]);
    assert.equal(queue.pendingCount(), 0);
  });

  it("push auto-flush does not leave unhandled rejection when upload fails", async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    const queue = createRecordingChunkQueue({
      maxPendingBytes: 2000,
      retryBaseMs: 60_000,
      uploadBlob: async () => {
        throw new Error("network");
      },
    });
    queue.push(blob(1500));
    queue.push(blob(1500));
    await queue.flush();

    process.off("unhandledRejection", onUnhandled);
    assert.equal(unhandled.length, 0);
    assert.ok(queue.pendingBlobBytes() > 0);
    queue._testClearRetry();
  });

  it("notifies failure then success callbacks across retry", async () => {
    let fail = true;
    const phases = [];
    const queue = createRecordingChunkQueue({
      retryBaseMs: 5,
      onUploadFailure: () => phases.push("fail"),
      onUploadSuccess: () => phases.push("ok"),
      uploadBlob: async () => {
        if (fail) {
          fail = false;
          throw new Error("err");
        }
      },
    });
    queue.push(blob(100));
    await queue.flush();
    await new Promise((r) => setTimeout(r, 30));
    await queue.flush();
    await queue.waitForIdle(2000);
    assert.deepEqual(phases, ["fail", "ok"]);
  });
});

describe("round55 P2-2 tasks input classification", () => {
  it("classifies bulk insertText, unknown script input, drop, and per-key typing", () => {
    assert.deepEqual(classifyLengthIncrease(218, "insertText", 0), {
      paste: 0,
      typing: 0,
      other: 218,
    });
    assert.deepEqual(classifyLengthIncrease(221, "unknown", 0), {
      paste: 0,
      typing: 0,
      other: 221,
    });
    assert.deepEqual(classifyLengthIncrease(273, "insertFromDrop", 0), {
      paste: 0,
      typing: 0,
      other: 273,
    });
    assert.deepEqual(classifyLengthIncrease(1, "insertText", 0), {
      paste: 0,
      typing: 1,
      other: 0,
    });
    assert.deepEqual(classifyLengthIncrease(25, "insertFromPaste", 0), {
      paste: 25,
      typing: 0,
      other: 0,
    });
  });

  it("tasks telemetry harness: drop, plain input, bulk insertText, typing", () => {
    const { classifyLengthIncrease: classify } = require("../app/lib/assessment-input-classify");
    const events = [];
    let typedChars = 0;
    let typingPending = 0;
    let otherPending = 0;
    let otherPendingInputType = "";
    let suppressNext = false;

    const enqueue = (event_type, payload) => events.push({ event_type, payload });
    const flushTyping = () => {
      if (typingPending <= 0) return;
      enqueue("typing", { chars: typingPending });
      typingPending = 0;
    };
    const flushOther = () => {
      if (otherPending <= 0) return;
      enqueue("other_insert", {
        chars: otherPending,
        inputType: otherPendingInputType || "unknown",
      });
      otherPending = 0;
      otherPendingInputType = "";
    };

    const onDrop = (text) => {
      const chars = text.length;
      enqueue("drop", { chars });
      if (chars > 0) {
        typedChars += chars;
        enqueue("other_insert", { chars, inputType: "insertFromDrop" });
        suppressNext = true;
      }
    };

    const onInput = (ev, valueLen) => {
      if (suppressNext) {
        suppressNext = false;
        typedChars = valueLen;
        return;
      }
      if (valueLen <= typedChars) {
        typedChars = valueLen;
        return;
      }
      const delta = valueLen - typedChars;
      typedChars = valueLen;
      let inputType = "";
      if (ev && typeof ev.inputType === "string") inputType = ev.inputType;
      else if (delta > 0) inputType = "unknown";
      const parts = classify(delta, inputType, 0);
      if (parts.typing > 0) typingPending += parts.typing;
      if (parts.other > 0) {
        otherPending += parts.other;
        otherPendingInputType = inputType || otherPendingInputType;
      }
    };

    onDrop("d".repeat(273));
    assert.deepEqual(
      events.map((e) => e.event_type),
      ["drop", "other_insert"]
    );
    assert.equal(events[1].payload.inputType, "insertFromDrop");

    typedChars = 0;
    suppressNext = false;
    otherPending = 0;
    events.length = 0;
    onInput({}, 221);
    flushOther();
    assert.deepEqual(events, [
      { event_type: "other_insert", payload: { chars: 221, inputType: "unknown" } },
    ]);

    events.length = 0;
    typedChars = 0;
    otherPending = 0;
    onInput({ inputType: "insertText" }, 218);
    flushOther();
    assert.deepEqual(events, [
      { event_type: "other_insert", payload: { chars: 218, inputType: "insertText" } },
    ]);

    events.length = 0;
    typedChars = 0;
    for (let i = 0; i < 3; i += 1) {
      onInput({ inputType: "insertText" }, i + 1);
    }
    flushTyping();
    assert.deepEqual(events, [{ event_type: "typing", payload: { chars: 3 } }]);
  });

  it("other_insert chars count toward otherInsertedChars in integrity metrics", () => {
    const answer = "x".repeat(400);
    const events = [
      ev("other_insert", { chars: 200, inputType: "insertFromDrop" }),
      ev("other_insert", { chars: 200, inputType: "unknown" }),
      ev("submit", { length: answer.length }),
    ];
    const attempt = {
      answer_text: answer,
      opened_at: new Date(Date.now() - 60_000).toISOString(),
      submitted_at: new Date().toISOString(),
      action_source: "web",
      timed_out: 0,
    };
    const { metrics } = computeAttemptIntegrity(events, attempt);
    assert.equal(metrics.otherInsertedChars, 400);
    assert.equal(metrics.typedChars, 0);
    assert.equal(metrics.unattributedChars, 0);
  });
});
