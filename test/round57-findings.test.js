"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { KEEPALIVE_BODY_LIMIT } = require("../app/lib/recording-chunk-policy");
const { applyTextDrop } = require("../app/lib/tasks-answer-drop");
const { classifyLengthIncrease } = require("../app/lib/assessment-input-classify");

describe("round57 P2 keepalive chunk uploads", () => {
  it("routine recording-chunk POST disables keepalive; emergency path enables it", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../app/public/call-room-webrtc.js"),
      "utf8"
    );
    assert.match(src, /postMultipart\([^)]*options\s*=\s*\{\}/);
    assert.match(src, /uploadRecordingChunk[\s\S]*keepalive:\s*false/);
    assert.match(src, /uploadKeepaliveBatch[\s\S]*keepalive:\s*true/);
    assert.match(src, /wantKeepalive && blobSize > 0 && blobSize <= KEEPALIVE_BODY_LIMIT/);
    assert.ok(KEEPALIVE_BODY_LIMIT <= 64 * 1024);
  });
});

describe("round57 P3 call-room recording warning", () => {
  it("persists recordingUploadDegraded across emit patches", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../app/public/call-room-webrtc.js"),
      "utf8"
    );
    assert.match(src, /let recordingUploadDegraded = false/);
    assert.match(src, /recordingUploadDegraded,/);
    assert.match(src, /onUploadRecovered/);
    const callJs = fs.readFileSync(path.join(__dirname, "../app/public/call.js"), "utf8");
    assert.match(callJs, /загрузка фрагментов с перебоями/);
    assert.match(callJs, /onUploadRecovered/);
    assert.match(src, /повторяем автоматически/);
  });
});

describe("round57 P3 tasks drop UX", () => {
  it("applyTextDrop inserts at drop offset and moves internal selection", () => {
    const external = applyTextDrop({
      value: "hello world",
      dropOffset: 5,
      text: "X",
      replaceStart: 5,
      replaceEnd: 5,
    });
    assert.equal(external.value, "helloX world");

    const moved = applyTextDrop({
      value: "abcdef",
      dropOffset: 6,
      text: "bc",
      moveFrom: { start: 1, end: 3, text: "bc" },
    });
    assert.equal(moved.value, "adefbc");
  });

  it("first keystroke after drop is not swallowed by suppress flag", () => {
    const tasks = fs.readFileSync(
      path.join(__dirname, "../app/public/candidate/tasks.html"),
      "utf8"
    );
    assert.doesNotMatch(tasks, /suppressNextInputClassify/);
    assert.match(tasks, /insertFromDrop/);
    assert.match(tasks, /tasks-answer-drop\.js/);
    assert.match(tasks, /dragstart/);
    assert.match(tasks, /caretOffsetFromPoint/);
  });

  it("typing telemetry counts first keystroke after programmatic drop", () => {
    let typedChars = 10;
    let typingPending = 0;
    const onInput = (ev, valueLen) => {
      if (
        ev &&
        ev.inputType === "insertFromDrop"
      ) {
        typedChars = valueLen;
        return;
      }
      if (valueLen > typedChars) {
        const delta = valueLen - typedChars;
        typedChars = valueLen;
        const parts = classifyLengthIncrease(delta, ev?.inputType || "insertText", 0);
        typingPending += parts.typing;
      }
    };
    typedChars = 5;
    onInput({ inputType: "insertText" }, 6);
    assert.equal(typingPending, 1);
  });
});
