"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const answers = require("../scripts/fixtures/canonical-answer-ab.json");
const {
  assertRecordingChunkUpload,
  isWebmMediaContinuationBuffer,
  MIN_CONTINUATION_CHUNK_BYTES,
} = require("../app/lib/webm");
const {
  duplicateQuickAnswerMultiplier,
  applyBatteryScoreGuards,
  aggregateBattery,
} = require("../app/lib/rubric-score");
const { buildCallAnalysisSummary } = require("../app/lib/call-analysis-summary");
const { MIN_PLAYABLE_RECORDING_BYTES } = require("../app/lib/call-recording");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r34-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  process.env.CALLS_DIR = path.join(os.tmpdir(), `hc-r34-calls-${process.pid}-${Date.now()}`);
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

function fakeEbml(size = MIN_PLAYABLE_RECORDING_BYTES + 200) {
  const buf = Buffer.alloc(size, 0xab);
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

/** Real Chromium MediaRecorder VP9 continuation header (not cluster, not EBML). */
function fakeMediaRecorderContinuation(size = 8000) {
  const buf = Buffer.alloc(size, 0x11);
  buf[0] = 0x41;
  buf[1] = 0xe3;
  buf[2] = 0x81;
  buf[3] = 0x01;
  return buf;
}

describe("round34 prod findings", () => {
  let app;
  let tmpDb;

  before(() => {
    ({ app, tmpDb } = freshApp());
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("P0-1: accepts MediaRecorder mid-cluster continuation bytes", () => {
    const cont = fakeMediaRecorderContinuation(6000);
    assert.ok(cont.length >= MIN_CONTINUATION_CHUNK_BYTES);
    assert.ok(isWebmMediaContinuationBuffer(cont));
    const file = { buffer: cont, mimetype: "video/webm" };
    assert.equal(assertRecordingChunkUpload(file, true), true);
    assert.equal(assertRecordingChunkUpload(file, false), false);
  });

  it("P0-1: recording-chunk accepts continuation then finalizes", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r34 rec', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(`INSERT INTO calls (id, invitation_id, status, started_at) VALUES (?, ?, 'live', datetime('now'))`).run(
      callId,
      invId
    );
    const cafeAgent = request.agent(app);
    await cafeAgent.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const chunk1 = await cafeAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeEbml(12000), "c1.webm");
    assert.equal(chunk1.status, 200);
    const chunk2 = await cafeAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeMediaRecorderContinuation(15000), "c2.webm");
    assert.equal(chunk2.status, 200);
    const fin = await cafeAgent.post(`/api/calls/${callId}/recording`).field("durationMs", "30000");
    assert.equal(fin.status, 200);
  });

  it("P0-1: call end merges orphan chunks when final upload missing", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r34 orphan', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    const started = new Date(Date.now() - 35000).toISOString();
    db.prepare(`INSERT INTO calls (id, invitation_id, status, started_at) VALUES (?, ?, 'live', ?)`).run(
      callId,
      invId,
      started
    );
    const annaAgent = request.agent(app);
    await annaAgent.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });
    await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeEbml(12000), "c1.webm");
    await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeMediaRecorderContinuation(9000), "c2.webm");
    const end = await annaAgent.post(`/api/calls/${callId}/end`);
    assert.equal(end.status, 200);
    const call = db.prepare("SELECT recording_path FROM calls WHERE id = ?").get(callId);
    const finalPath = path.join(call.recording_path, "candidate.webm");
    assert.ok(fs.existsSync(finalPath));
    assert.ok(fs.statSync(finalPath).size >= MIN_PLAYABLE_RECORDING_BYTES);
  });

  it("P2: identical quick answers reduce score below middle cutoff", () => {
    const attempts = Array.from({ length: 8 }, (_, i) => ({
      type: "quick",
      answer_text: answers.quickAnswer,
      id: `a${i}`,
    }));
    attempts.push({ type: "work", answer_text: answers.workAnswer, id: "w" });
    const mult = duplicateQuickAnswerMultiplier(attempts);
    assert.ok(mult < 0.5);
    const base = aggregateBattery(
      attempts.filter((a) => a.type === "quick").map(() => ({ knowledge: 0.9, breadth: 0.85 })),
      { knowledge: 0.9, breadth: 0.85 }
    );
    const guarded = applyBatteryScoreGuards(base, attempts);
    assert.ok(guarded.test_score < 0.68);
  });

  it("P2: per-question quick rubrics are seeded", () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT rubric_json FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND form_key = 'A' ORDER BY rowid LIMIT 3`
      )
      .all();
    assert.ok(rows.length >= 2);
    const r0 = JSON.parse(rows[0].rubric_json);
    const r1 = JSON.parse(rows[1].rubric_json);
    assert.ok(Array.isArray(r0.keys) && typeof r0.keys[0] === "string");
    assert.notDeepEqual(r0.keys, r1.keys);
  });

  it("P2: analysis summary distinguishes partial recording", () => {
    const summary = buildCallAnalysisSummary({
      needDomainText: "",
      transcript: "Кандидат: hi. Работодатель: ok.",
      call: { started_at: "2026-01-01 10:00:00", ended_at: "2026-01-01 10:05:00" },
      hasRecordingFile: true,
      recordingSides: ["employer"],
    });
    assert.match(summary.summary_text, /только со стороны работодателя/i);
  });
});
