"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { MIN_PLAYABLE_RECORDING_BYTES } = require("../app/lib/call-recording");
function fakeEbml(size = MIN_PLAYABLE_RECORDING_BYTES + 200) {
  const buf = Buffer.alloc(size, 0xab);
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

function fakeMediaRecorderContinuation(size = 8000) {
  const buf = Buffer.alloc(size, 0x11);
  buf[0] = 0x41;
  buf[1] = 0xe3;
  buf[2] = 0x81;
  buf[3] = 0x01;
  return buf;
}

function fakeCluster(size = MIN_PLAYABLE_RECORDING_BYTES + 200) {
  const buf = Buffer.alloc(size, 0xcd);
  buf[0] = 0x1f;
  buf[1] = 0x43;
  buf[2] = 0xb6;
  buf[3] = 0x75;
  return buf;
}

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r107-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  process.env.CALLS_DIR = path.join(os.tmpdir(), `hc-r107-calls-${process.pid}-${Date.now()}`);
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

describe("round107 recording regressions", () => {
  it("deploy workflow polls /api/health with commit verification", () => {
    const yml = fs.readFileSync(path.join(__dirname, "../.github/workflows/deploy.yml"), "utf8");
    assert.match(yml, /HEALTH_DEADLINE/);
    assert.match(yml, /GIT_COMMIT/);
    assert.match(yml, /while \[ "\$\(date \+%s\)" -lt "\$HEALTH_DEADLINE" \]/);
    assert.doesNotMatch(yml, /sleep 3\n\s+curl -fsS --max-time 15/);
  });

  it("late chunk + tail after orphan merge are accepted and merged once", async () => {
    const { app } = freshApp();
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r107 late', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, started_at, consent_at_candidate, consent_at_employer) VALUES (?, ?, 'live', datetime('now'), datetime('now'), datetime('now'))`
    ).run(callId, invId);
    const cafeAgent = request.agent(app);
    const annaAgent = request.agent(app);
    await cafeAgent.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    await annaAgent.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });

    await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeEbml(12_000), "c1.webm");
    await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeMediaRecorderContinuation(9_000), "c2.webm");

    const endRes = await cafeAgent.post(`/api/calls/${callId}/end`);
    assert.equal(endRes.status, 200);
    await new Promise((r) => setTimeout(r, 80));

    const store = require("../app/lib/recording-store");
    const orphanSize = fs.statSync(path.join(store.callDir(callId), "candidate.webm")).size;
    assert.ok(orphanSize >= MIN_PLAYABLE_RECORDING_BYTES);

    const lateChunk = await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeMediaRecorderContinuation(7_000), "late.webm");
    assert.equal(lateChunk.status, 200, lateChunk.body?.error || lateChunk.text);

    const tail = fakeCluster(6_000);
    const fin1 = await annaAgent
      .post(`/api/calls/${callId}/recording`)
      .attach("file", tail, "tail.webm")
      .field("durationMs", "45000");
    assert.equal(fin1.status, 200);
    const afterMerge = fs.statSync(path.join(store.callDir(callId), "candidate.webm")).size;
    assert.ok(afterMerge >= orphanSize);

    const fin2 = await annaAgent
      .post(`/api/calls/${callId}/recording`)
      .attach("file", tail, "tail.webm")
      .field("durationMs", "45000");
    assert.equal(fin2.status, 200);
    const afterDup = fs.statSync(path.join(store.callDir(callId), "candidate.webm")).size;
    assert.equal(afterDup, afterMerge);

    const fin3 = await annaAgent.post(`/api/calls/${callId}/recording`).field("durationMs", "45000");
    assert.equal(fin3.status, 200);
    assert.equal(fs.statSync(path.join(store.callDir(callId), "candidate.webm")).size, afterMerge);
  });

  it("call analysis lists both sides after orphan merge and after late finalize", async () => {
    const { app } = freshApp();
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r107 analysis', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, started_at, consent_at_candidate, consent_at_employer) VALUES (?, ?, 'live', datetime('now'), datetime('now'), datetime('now'))`
    ).run(callId, invId);
    const cafeAgent = request.agent(app);
    const annaAgent = request.agent(app);
    await cafeAgent.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    await annaAgent.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });

    await cafeAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeEbml(12_000), "emp1.webm");
    await cafeAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeMediaRecorderContinuation(8_000), "emp2.webm");
    await cafeAgent.post(`/api/calls/${callId}/recording`).field("durationMs", "30000");

    await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeEbml(12_000), "cand.webm");

    await cafeAgent.post(`/api/calls/${callId}/end`);
    await new Promise((r) => setTimeout(r, 400));

    let row = db.prepare("SELECT summary_text FROM call_analyses WHERE call_id = ?").get(callId);
    assert.ok(row, "analysis row after end");
    assert.match(row.summary_text, /обеих сторон/i, row.summary_text);

    db.prepare(
      `UPDATE call_analyses SET summary_text = ? WHERE call_id = ?`
    ).run("stale single-side summary", callId);

    await annaAgent
      .post(`/api/calls/${callId}/recording`)
      .attach("file", fakeCluster(5_000), "tail.webm")
      .field("durationMs", "35000");
    await new Promise((r) => setTimeout(r, 400));

    row = db.prepare("SELECT summary_text FROM call_analyses WHERE call_id = ?").get(callId);
    assert.ok(row);
    assert.match(row.summary_text, /обеих сторон/i, row.summary_text);
    assert.doesNotMatch(row.summary_text, /stale single-side/i);
  });

  it("late chunk merged on duration-only finalize after orphan merge; chunks removed", async () => {
    const { app } = freshApp();
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r107 duration-only late chunk', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, started_at, consent_at_candidate, consent_at_employer) VALUES (?, ?, 'live', datetime('now'), datetime('now'), datetime('now'))`
    ).run(callId, invId);
    const cafeAgent = request.agent(app);
    const annaAgent = request.agent(app);
    await cafeAgent.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    await annaAgent.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });

    await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeEbml(12_000), "c1.webm");
    await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeMediaRecorderContinuation(9_000), "c2.webm");

    await cafeAgent.post(`/api/calls/${callId}/end`);
    await new Promise((r) => setTimeout(r, 80));

    const store = require("../app/lib/recording-store");
    const orphanSize = fs.statSync(path.join(store.callDir(callId), "candidate.webm")).size;
    assert.ok(orphanSize >= MIN_PLAYABLE_RECORDING_BYTES);

    const lateChunk = await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeMediaRecorderContinuation(7_000), "late.webm");
    assert.equal(lateChunk.status, 200, lateChunk.body?.error || lateChunk.text);
    assert.equal(store.listChunkFiles(callId, "candidate").length, 1);

    const fin1 = await annaAgent.post(`/api/calls/${callId}/recording`).field("durationMs", "45000");
    assert.equal(fin1.status, 200);
    const afterMerge = fs.statSync(path.join(store.callDir(callId), "candidate.webm")).size;
    assert.ok(afterMerge > orphanSize);
    assert.equal(store.listChunkFiles(callId, "candidate").length, 0);

    const fin2 = await annaAgent.post(`/api/calls/${callId}/recording`).field("durationMs", "45000");
    assert.equal(fin2.status, 200);
    assert.equal(fs.statSync(path.join(store.callDir(callId), "candidate.webm")).size, afterMerge);
  });

  it("orphan final accepts first tail-only finalize then ignores duplicate tail", () => {
    const dataDir = path.join(os.tmpdir(), `hc-r107-tail-only-${process.pid}-${Date.now()}`);
    process.env.CALLS_DIR = path.join(dataDir, "calls");
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const store = require("../app/lib/recording-store");
    const callId = `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
    store.appendChunk(callId, "candidate", fakeEbml(12_000));
    store.mergeChunksToFinal(callId, "candidate", Buffer.alloc(0), 30_000);
    const before = fs.statSync(path.join(store.callDir(callId), "candidate.webm")).size;
    const tail = fakeCluster(6_000);
    const path1 = store.writeFinalRecording(callId, "candidate", tail, 40_000);
    assert.ok(path1);
    const afterFirst = fs.statSync(path1).size;
    assert.ok(afterFirst > before);
    const path2 = store.writeFinalRecording(callId, "candidate", tail, 40_000);
    assert.equal(path2, path1);
    assert.equal(fs.statSync(path1).size, afterFirst);
  });

  it("hasRecordingContinuationContext treats orphan final as continuation", () => {
    const dataDir = path.join(os.tmpdir(), `hc-r107-ctx-${process.pid}-${Date.now()}`);
    process.env.CALLS_DIR = path.join(dataDir, "calls");
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const store = require("../app/lib/recording-store");
    const callId = `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
    store.appendChunk(callId, "candidate", fakeEbml(12_000));
    store.mergeChunksToFinal(callId, "candidate", Buffer.alloc(0), 30_000);
    assert.equal(store.listChunkFiles(callId, "candidate").length, 0);
    assert.ok(store.hasRecordingContinuationContext(callId, "candidate"));
  });
});
