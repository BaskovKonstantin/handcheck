"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const answers = require("../scripts/fixtures/canonical-answer-ab.json");
const {
  BATTERY_QUICK_COUNT,
  QUICK_DEADLINE_MS,
  WORK_DEADLINE_MS,
} = require("../app/lib/assessment-timing");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-rules26-${process.pid}-${Date.now()}.sqlite`);
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
    displayName: "Rules",
    stack: ["node"],
    phone: "+79001112233",
    contactEmail: email,
  });
  return agent;
}

describe("assessment rules 2026-10-06", () => {
  let app;
  let tmpDb;

  before(() => {
    ({ app, tmpDb } = freshApp());
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("seed has 8 quick tasks per backend middle form", () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    for (const form of ["A", "B"]) {
      const c = db
        .prepare(
          `SELECT COUNT(*) AS c FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published'`
        )
        .get(form).c;
      assert.equal(c, BATTERY_QUICK_COUNT);
    }
  });

  it("enforces 60s quick limit but keeps answer and advances", async () => {
    const agent = await registerCandidate(app, `quick-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cur = await agent.get("/api/assessment/battery/current");
    const firstId = cur.body.battery.attempts[0].id;
    await agent.post(`/api/assessment/tasks/${firstId}/open`);
    const { getDb } = require("../app/db");
    const db = getDb();
    const expired = new Date(Date.now() - QUICK_DEADLINE_MS - 5000).toISOString();
    db.prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      expired,
      expired,
      firstId
    );
    const res = await agent
      .post(`/api/assessment/tasks/${firstId}/submit`)
      .send({ answerText: answers.quickAnswer });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "quick_time_expired");
    assert.match(res.body.message || "", /истекло|время/i);
    const row = db
      .prepare("SELECT answer_text, late_answer_text, submitted_at FROM attempts WHERE id = ?")
      .get(firstId);
    assert.ok(row.submitted_at);
    assert.ok(
      row.answer_text.length > 20 || String(row.late_answer_text || "").length > 20,
      "expected stored answer or late text"
    );
    const cur2 = await agent.get("/api/assessment/battery/current");
    assert.equal(cur2.body.battery.attempts[0].submitted, true);
  });

  it("stores paste telemetry without blocking scoring", async () => {
    const agent = await registerCandidate(app, `paste-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cur = await agent.get("/api/assessment/battery/current");
    const attemptId = cur.body.battery.attempts[0].id;
    await agent.post(`/api/assessment/tasks/${attemptId}/open`);
    await agent.post("/api/assessment/events").send({
      events: [{ attemptId, event_type: "paste", payload: { length: 400 } }],
    });
    const res = await agent
      .post(`/api/assessment/tasks/${attemptId}/submit`)
      .send({ answerText: answers.quickAnswer });
    assert.equal(res.status, 200);
    const { getDb } = require("../app/db");
    const paste = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM attempt_events WHERE attempt_id = ? AND event_type = 'paste'`
      )
      .get(attemptId).c;
    assert.ok(paste >= 1);
  });

  it("work deadline is seven days from opened_at", () => {
    assert.equal(WORK_DEADLINE_MS, 7 * 24 * 60 * 60 * 1000);
  });

  it("rejects work submit after deadline but saves text", async () => {
    const agent = await registerCandidate(app, `work-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const { getDb } = require("../app/db");
    const db = getDb();
    let cur = await agent.get("/api/assessment/battery/current");
    for (const step of cur.body.battery.attempts.filter((a) => !a.submitted)) {
      const task = await agent.get(`/api/assessment/tasks/${step.id}`);
      if (task.body.type === "work") break;
      await agent.post(`/api/assessment/tasks/${step.id}/open`);
      await agent.post(`/api/assessment/tasks/${step.id}/submit`).send({
        answerText: answers.quickAnswer,
      });
      cur = await agent.get("/api/assessment/battery/current");
    }
    const workStep = cur.body.battery.attempts.find((a) => !a.submitted);
    const workId = workStep.id;
    await agent.post(`/api/assessment/tasks/${workId}/open`);
    const expired = new Date(Date.now() - WORK_DEADLINE_MS - 1000).toISOString();
    db.prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      expired,
      expired,
      workId
    );
    const res = await agent
      .post(`/api/assessment/tasks/${workId}/submit`)
      .send({ answerText: answers.workAnswer });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "deadline_passed");
    const row = db.prepare("SELECT answer_text, submitted_at FROM attempts WHERE id = ?").get(workId);
    assert.equal(row.submitted_at, null);
    assert.ok(row.answer_text.length > 10);
  });
});
