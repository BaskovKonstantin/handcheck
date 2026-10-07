"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const answers = require("../scripts/fixtures/canonical-answer-ab.json");
const { QUICK_DEADLINE_MS } = require("../app/lib/assessment-timing");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r31-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

async function registerCandidate(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send(registerPayload({ email, role: "candidate" }));
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  await agent.put("/api/candidate/profile").send({
    displayName: "R31",
    stack: ["node"],
    phone: "+79001112233",
    contactEmail: email,
  });
  return agent;
}

describe("round31 findings", () => {
  let app;
  let tmpDb;
  let services;

  before(() => {
    ({ app, tmpDb } = freshApp());
    services = require("../app/modules/mcp/services");
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("P1-3: list_tasks hides unopened prompts; submit without open is rejected", async () => {
    const agent = await registerCandidate(app, `r31-mcp-${Date.now()}@demo.local`);
    const start = await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    assert.equal(start.status, 201);
    const { getDb } = require("../app/db");
    const userId = (await agent.get("/api/me")).body.id;
    const listed = services.listAssessmentTasks(userId);
    assert.ok(listed.battery, "expected active battery in MCP list");
    assert.ok(listed.tasks.length >= 9, `expected tasks, got ${listed.tasks.length}`);
    const first = listed.tasks[0];
    assert.equal(first.prompt, null);
    assert.equal(first.needsOpen, true);
    const res = await agent.post(`/api/assessment/tasks/${first.attemptId}/submit`).send({
      answerText: answers.quickAnswer,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "task_not_opened");
  });

  it("P1-3: MCP get_task starts clock; late submit is quick_time_expired", async () => {
    const agent = await registerCandidate(app, `r31-late-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const { getDb } = require("../app/db");
    const userId = (await agent.get("/api/me")).body.id;
    const cur = await agent.get("/api/assessment/battery/current");
    const attemptId = cur.body.battery.attempts[0].id;
    services.getAssessmentTask(userId, attemptId);
    const expired = new Date(Date.now() - QUICK_DEADLINE_MS - 5000).toISOString();
    getDb().prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      expired,
      expired,
      attemptId
    );
    getDb().prepare("UPDATE attempts SET answer_text = ? WHERE id = ?").run("draft-before", attemptId);
    try {
      services.submitAttemptAnswer(userId, attemptId, "late-after-deadline-text", "mcp", {
        requireQuick: true,
      });
      assert.fail("expected quick_time_expired");
    } catch (e) {
      assert.equal(e.mcpCode, "quick_time_expired");
    }
    const row = getDb()
      .prepare("SELECT answer_text, late_answer_text, knowledge FROM attempts WHERE id = ?")
      .get(attemptId);
    assert.equal(row.answer_text, "draft-before");
    assert.ok(row.late_answer_text.includes("late-after"));
  });

  it("P1-3: empty quick timeout advances battery", async () => {
    const agent = await registerCandidate(app, `r31-empty-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cur = await agent.get("/api/assessment/battery/current");
    const attemptId = cur.body.battery.attempts[0].id;
    await agent.post(`/api/assessment/tasks/${attemptId}/open`);
    const { getDb } = require("../app/db");
    const expired = new Date(Date.now() - QUICK_DEADLINE_MS - 5000).toISOString();
    getDb().prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      expired,
      expired,
      attemptId
    );
    const res = await agent.post(`/api/assessment/tasks/${attemptId}/submit`).send({ answerText: "" });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "quick_time_expired");
    const cur2 = await agent.get("/api/assessment/battery/current");
    assert.equal(cur2.body.battery.attempts[0].submitted, true);
  });

  it("P1-4: events endpoint rejects unknown types and closed attempts", async () => {
    const agent = await registerCandidate(app, `r31-ev-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const attemptId = (await agent.get("/api/assessment/battery/current")).body.battery.attempts[0].id;
    const bad = await agent.post("/api/assessment/events").send({
      events: [{ attemptId, event_type: "typing_ok_trust_me", payload: { x: 1 } }],
    });
    assert.equal(bad.status, 400);
    await agent.post(`/api/assessment/tasks/${attemptId}/open`);
    await agent.post(`/api/assessment/tasks/${attemptId}/submit`).send({ answerText: answers.quickAnswer });
    const closed = await agent.post("/api/assessment/events").send({
      events: [{ attemptId, event_type: "typing", payload: { chars: 1 } }],
    });
    assert.equal(closed.status, 409);
  });

  it("P1-4: typing without server paste heuristic", async () => {
    const agent = await registerCandidate(app, `r31-type-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const attemptId = (await agent.get("/api/assessment/battery/current")).body.battery.attempts[0].id;
    await agent.post(`/api/assessment/tasks/${attemptId}/open`);
    await agent.post("/api/assessment/events").send({
      events: [{ attemptId, event_type: "typing", payload: { chars: 120 } }],
    });
    await agent.patch(`/api/assessment/tasks/${attemptId}/draft`).send({
      answerText: "x".repeat(120),
    });
    const { getDb } = require("../app/db");
    const paste = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM attempt_events WHERE attempt_id = ? AND event_type = 'paste'`
      )
      .get(attemptId).c;
    assert.equal(paste, 0);
  });

  it("P1-5: privacy consent records stored for assessment start", async () => {
    const agent = await registerCandidate(app, `r31-pd-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const { getDb } = require("../app/db");
    const userId = getDb().prepare("SELECT id FROM users WHERE email LIKE 'r31-pd-%' ORDER BY rowid DESC LIMIT 1").get().id;
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM data_processing_consents WHERE user_id = ? AND context = 'assessment'`
      )
      .get(userId).c;
    assert.ok(row >= 1);
  });

  it("P2-2: candidate cannot download employer recording side", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r31 rec', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, recording_path) VALUES (?, ?, 'ended', ?)`
    ).run(callId, invId, path.join(os.tmpdir(), `hc-rec-${callId}`));
    const dir = db.prepare("SELECT recording_path FROM calls WHERE id = ?").get(callId).recording_path;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "employer.webm"), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const annaAgent = request.agent(app);
    await annaAgent.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });
    const res = await annaAgent.get(`/api/calls/${callId}/recording?side=employer`);
    assert.equal(res.status, 403);
  });

  it("P2-5: submit not_current_task returns RU message", async () => {
    const agent = await registerCandidate(app, `r31-order-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cur = await agent.get("/api/assessment/battery/current");
    const second = cur.body.battery.attempts[1].id;
    const res = await agent.post(`/api/assessment/tasks/${second}/submit`).send({
      answerText: answers.quickAnswer,
    });
    assert.equal(res.status, 409);
    assert.ok(res.body.error === "not_current_task" || /предыдущий/i.test(res.body.message || ""));
  });

  it("P1-1/P2-4: webrtc client gates on connectionState and speech backoff", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(src, /connectionState === "connected"/);
    assert.match(src, /WS_SIGNAL\.HELLO|"hello"/);
    assert.match(src, /speechRestartAttempts/);
    assert.match(src, /onTranscriptError/);
    assert.match(src, /recording-chunk/);
  });

  it("P1-2: recorder bitrate margin under 80 MB/hour", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    const RECORDING_LIMIT_BYTES = 80 * 1024 * 1024;
    const RECORDING_TARGET_SECONDS = 60 * 60;
    const RECORDER_TOTAL_BPS = 100_000 + 15_000;
    assert.match(src, /RECORDER_VIDEO_BPS\s*=\s*100_000/);
    const projected = (RECORDER_TOTAL_BPS / 8) * RECORDING_TARGET_SECONDS;
    assert.ok(projected < RECORDING_LIMIT_BYTES * 0.85);
  });
});
