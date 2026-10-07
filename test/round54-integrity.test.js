"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { computeAttemptIntegrity } = require("../app/lib/integrity");
const { classifyLengthIncrease } = require("../app/lib/assessment-input-classify");

function ev(type, payload) {
  return { event_type: type, payload_json: JSON.stringify(payload || {}) };
}

describe("round54 integrity computation", () => {
  it("typed-only clean attempt has low integrity", () => {
    const answer = "a".repeat(120);
    const events = [
      ev("first_input", { length: 1 }),
      ev("typing", { chars: 120 }),
      ev("submit", { length: answer.length }),
    ];
    const attempt = {
      answer_text: answer,
      opened_at: new Date(Date.now() - 45_000).toISOString(),
      submitted_at: new Date().toISOString(),
      action_source: "web",
      timed_out: 0,
    };
    const { integrity, metrics } = computeAttemptIntegrity(events, attempt);
    assert.equal(metrics.unattributedChars, 0);
    assert.ok(integrity < 0.5, `expected low integrity, got ${integrity}`);
  });

  it("pasted chars weigh by character count not event count", () => {
    const answer = "x".repeat(200);
    const events = [
      ev("paste", { chars: 200 }),
      ev("submit", { length: 200 }),
    ];
    const attempt = {
      answer_text: answer,
      opened_at: new Date(Date.now() - 5000).toISOString(),
      submitted_at: new Date().toISOString(),
      action_source: "web",
      timed_out: 0,
    };
    const { integrity, metrics } = computeAttemptIntegrity(events, attempt);
    assert.equal(metrics.pastedChars, 200);
    assert.equal(metrics.unattributedChars, 0);
    assert.ok(integrity >= 0.65, `paste-heavy should raise signal, got ${integrity}`);
  });

  it("long unattributed answer submitted immediately is flagged", () => {
    const answer = "z".repeat(350);
    const events = [
      ev("first_input", { length: answer.length }),
      ev("submit", { length: answer.length }),
    ];
    const opened = new Date().toISOString();
    const attempt = {
      answer_text: answer,
      opened_at: opened,
      submitted_at: opened,
      action_source: "web",
      timed_out: 0,
    };
    const { integrity, metrics } = computeAttemptIntegrity(events, attempt);
    assert.equal(metrics.unattributedChars, 350);
    assert.ok(integrity >= 0.85, `expected flagged integrity, got ${integrity}`);
  });

  it("MCP action_source does not treat missing telemetry as unattributed", () => {
    const answer = "m".repeat(400);
    const events = [ev("submit", { length: answer.length })];
    const attempt = {
      answer_text: answer,
      opened_at: new Date().toISOString(),
      submitted_at: new Date().toISOString(),
      action_source: "mcp",
      timed_out: 0,
    };
    const { integrity, metrics } = computeAttemptIntegrity(events, attempt);
    assert.equal(metrics.unattributedChars, 0);
    assert.ok(integrity < 0.85, `MCP should not be flagged unattributed, got ${integrity}`);
  });

  it("empty timed-out quick attempt stays neutral", () => {
    const events = [ev("quick_timeout", { length: 0 })];
    const attempt = {
      answer_text: "",
      opened_at: new Date().toISOString(),
      submitted_at: new Date().toISOString(),
      action_source: "web",
      timed_out: 1,
    };
    const { integrity } = computeAttemptIntegrity(events, attempt);
    assert.equal(integrity, 0);
  });
});

describe("round54 tasks input classification", () => {
  it("classifies drop and replacement as other, paste and typing separately", () => {
    assert.deepEqual(classifyLengthIncrease(30, "insertFromDrop", 0), {
      paste: 0,
      typing: 0,
      other: 30,
    });
    assert.deepEqual(classifyLengthIncrease(40, "insertReplacementText", 0), {
      paste: 0,
      typing: 0,
      other: 40,
    });
    assert.deepEqual(classifyLengthIncrease(25, "insertFromPaste", 0), {
      paste: 25,
      typing: 0,
      other: 0,
    });
    assert.deepEqual(classifyLengthIncrease(3, "insertText", 0), {
      paste: 0,
      typing: 3,
      other: 0,
    });
    assert.deepEqual(classifyLengthIncrease(218, "insertText", 0), {
      paste: 0,
      typing: 0,
      other: 218,
    });
  });

  it("tasks.html wires InputEvent classification and drop telemetry", () => {
    const tasks = fs.readFileSync(
      path.join(__dirname, "../app/public/candidate/tasks.html"),
      "utf8"
    );
    assert.match(tasks, /assessment-input-classify\.js/);
    assert.match(tasks, /HandCheckInputClassify\.classifyLengthIncrease/);
    assert.match(tasks, /other_insert/);
    assert.match(tasks, /addEventListener\("drop"/);
    assert.match(tasks, /ev\.inputType/);
  });

  it("server accepts other_insert and drop events", () => {
    const { ALLOWED_EVENT_TYPES, validateClientEvent } = require("../app/lib/assessment-events");
    assert.ok(ALLOWED_EVENT_TYPES.has("other_insert"));
    assert.ok(ALLOWED_EVENT_TYPES.has("drop"));
    assert.equal(validateClientEvent({ event_type: "other_insert", payload: { chars: 5 } }).ok, true);
    assert.equal(validateClientEvent({ event_type: "drop", payload: { chars: 1 } }).ok, true);
  });
});
