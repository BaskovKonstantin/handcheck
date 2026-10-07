"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const answers = require("../scripts/fixtures/canonical-answer-ab.json");
const { QUICK_DEADLINE_MS, QUICK_GRACE_MS } = require("../app/lib/assessment-timing");
const {
  assertRecordingChunkUpload,
  isWebmClusterBuffer,
} = require("../app/lib/webm");
const {
  isPlayableRecordingFile,
  listPlayableRecordingSides,
  MIN_PLAYABLE_RECORDING_BYTES,
} = require("../app/lib/call-recording");
const { mergeBuffers } = require("../app/lib/recording-store");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r33-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  process.env.CALLS_DIR = path.join(os.tmpdir(), `hc-r33-calls-${process.pid}-${Date.now()}`);
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

function fakeCluster(size = MIN_PLAYABLE_RECORDING_BYTES + 200) {
  const buf = Buffer.alloc(size, 0xcd);
  buf[0] = 0x1f;
  buf[1] = 0x43;
  buf[2] = 0xb6;
  buf[3] = 0x75;
  return buf;
}

async function registerCandidate(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send(registerPayload({ email, role: "candidate" }));
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  await agent.put("/api/candidate/profile").send({
    displayName: "R33",
    stack: ["node"],
    phone: "+79001112233",
    contactEmail: email,
  });
  return agent;
}

describe("round33 findings", () => {
  let app;
  let tmpDb;

  before(() => {
    ({ app, tmpDb } = freshApp());
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("P0-1: continuation recording chunks without EBML header are accepted", () => {
    const first = { buffer: fakeEbml(6000), mimetype: "video/webm" };
    const cont = { buffer: fakeCluster(8000), mimetype: "video/webm" };
    assert.equal(assertRecordingChunkUpload(first, false), true);
    assert.equal(assertRecordingChunkUpload(cont, true), true);
    assert.equal(assertRecordingChunkUpload(cont, false), false);
    assert.ok(isWebmClusterBuffer(cont.buffer));
  });

  it("P0-1: stub webm is not a playable recording", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hc-stub-"));
    const fp = path.join(dir, "employer.webm");
    fs.writeFileSync(fp, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    assert.equal(isPlayableRecordingFile(fp), false);
    assert.deepEqual(listPlayableRecordingSides(dir), []);
  });

  it("P0-1: client does not use keepalive for large recording uploads", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(src, /KEEPALIVE_BODY_LIMIT/);
    assert.match(src, /keepalive: useKeepalive/);
    assert.doesNotMatch(src, /minimalWebm/);
  });

  it("P0-1: merge strips duplicate EBML when concatenating reload segments", () => {
    const a = fakeEbml(5000);
    const b = fakeEbml(5000);
    const merged = mergeBuffers([a, b]);
    assert.ok(merged.length < a.length + b.length);
    assert.equal(merged[0], 0x1a);
  });

  it("P1-1: empty quick submit inside grace window times out instead of 400", async () => {
    const agent = await registerCandidate(app, `r33-empty-grace-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const attemptId = (await agent.get("/api/assessment/battery/current")).body.battery.attempts[0].id;
    await agent.post(`/api/assessment/tasks/${attemptId}/open`);
    const { getDb } = require("../app/db");
    const opened = new Date(Date.now() - QUICK_DEADLINE_MS - 500).toISOString();
    getDb().prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      opened,
      opened,
      attemptId
    );
    const res = await agent.post(`/api/assessment/tasks/${attemptId}/submit`).send({ answerText: "" });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "quick_time_expired");
  });

  it("P1-2: draft after quick deadline is rejected and not used as answer", async () => {
    const agent = await registerCandidate(app, `r33-late-draft-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const attemptId = (await agent.get("/api/assessment/battery/current")).body.battery.attempts[0].id;
    await agent.post(`/api/assessment/tasks/${attemptId}/open`);
    await agent.patch(`/api/assessment/tasks/${attemptId}/draft`).send({
      answerText: "вовремя",
    });
    const { getDb } = require("../app/db");
    const expired = new Date(Date.now() - QUICK_DEADLINE_MS - 5000).toISOString();
    getDb().prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      expired,
      expired,
      attemptId
    );
    const late = await agent.patch(`/api/assessment/tasks/${attemptId}/draft`).send({
      answerText: "ПОЗДНИЙ черновик",
    });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, "deadline_passed");
    const submit = await agent.post(`/api/assessment/tasks/${attemptId}/submit`).send({
      answerText: "поздний submit",
    });
    assert.equal(submit.status, 409);
    const row = getDb()
      .prepare("SELECT answer_text, late_answer_text FROM attempts WHERE id = ?")
      .get(attemptId);
    assert.equal(row.answer_text, "вовремя");
    assert.ok(String(row.late_answer_text || "").includes("поздний"));
  });

  it("P1-3: privacy page uses public boot without auth redirect", () => {
    const privacy = fs.readFileSync(path.join(__dirname, "../app/public/privacy.html"), "utf8");
    const appJs = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
    assert.match(privacy, /bootPublicPage/);
    assert.match(appJs, /function bootPublicPage/);
    assert.match(appJs, /if \(expectedRole\) \{\s*window\.location\.href = "\/auth"/);
  });

  it("P1-4: parallel battery start returns one open battery", async () => {
    const agent = await registerCandidate(app, `r33-parallel-${Date.now()}@demo.local`);
    const body = { specialization: "backend", grade: "middle", privacyConsent: true };
    const [a, b] = await Promise.all([
      agent.post("/api/assessment/battery/start").send(body),
      agent.post("/api/assessment/battery/start").send(body),
    ]);
    assert.ok([200, 201].includes(a.status));
    assert.ok([200, 201].includes(b.status));
    assert.equal(a.body.batteryId, b.body.batteryId);
    const { getDb } = require("../app/db");
    const userId = (await agent.get("/api/me")).body.id;
    const openCount = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM batteries WHERE candidate_user_id = ? AND specialization = 'backend' AND completed_at IS NULL`
      )
      .get(userId).c;
    assert.equal(openCount, 1);
  });

  it("P1-5: webrtc client guards answer/setRemoteDescription states", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(src, /signalingState !== "have-local-offer"/);
    assert.match(src, /signalingState === "stable" && conn\.remoteDescription/);
  });

  it("P0-1: recording-chunk + finalize produces playable employer file", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r33 rec', 'email', 'accepted')`
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
      .attach("file", fakeCluster(15000), "c2.webm");
    assert.equal(chunk2.status, 200);
    const fin = await cafeAgent
      .post(`/api/calls/${callId}/recording`)
      .field("durationMs", "30000")
      .attach("file", fakeCluster(10000), "tail.webm");
    assert.equal(fin.status, 200);
    const call = db.prepare("SELECT recording_path FROM calls WHERE id = ?").get(callId);
    assert.ok(listPlayableRecordingSides(call.recording_path).includes("employer"));
    db.prepare("UPDATE calls SET status = 'ended', ended_at = datetime('now') WHERE id = ?").run(callId);
    const info = await cafeAgent.get(`/api/calls/for-invitation/${invId}`);
    assert.ok(info.body.recordingSides?.includes("employer"));
  });
});
