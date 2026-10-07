"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const { createWorkDraftLifecycle } = require("../app/lib/tasks-draft-persist");
const { remainingMsUntilDeadline } = require("../app/lib/assessment-timing");
const { WORK_DEADLINE_MS } = require("../app/lib/assessment-timing");
const answers = require("../scripts/fixtures/distinct-quick-answers");

function bootApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r60-${process.pid}-${Date.now()}.sqlite`);
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
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
  return agent;
}

async function openWorkAttempt(agent) {
  await agent.put("/api/candidate/profile").send({
    stack: ["node"],
    phone: "+79001234567",
    contactEmail: "w@test.local",
  });
  await agent.post("/api/assessment/battery/start").send({
    specialization: "backend",
    grade: "middle",
    privacyConsent: true,
  });
  const { getDb } = require("../app/db");
  const db = getDb();
  let quickIdx = 0;
  let cur = await agent.get("/api/assessment/battery/current");
  assert.ok(cur.body.battery?.attempts?.length);
  for (const step of cur.body.battery.attempts.filter((a) => !a.submitted)) {
    const task = await agent.get(`/api/assessment/tasks/${step.id}`);
    if (task.body.type === "work") break;
    await agent.post(`/api/assessment/tasks/${step.id}/open`);
    await agent.post(`/api/assessment/tasks/${step.id}/submit`).send({
      answerText: answers.quickAnswerForIndex(quickIdx++),
    });
    cur = await agent.get("/api/assessment/battery/current");
  }
  const workStep = cur.body.battery.attempts.find((a) => !a.submitted);
  await agent.post(`/api/assessment/tasks/${workStep.id}/open`);
  return { workId: workStep.id, db };
}

describe("round60 P3-1 work draft POST (sendBeacon) flush", () => {
  let app;

  before(() => {
    app = bootApp().app;
  });

  it("POST /draft persists like PATCH (pagehide sendBeacon path)", async () => {
    const agent = await registerCandidate(app, `r60-post-draft-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    const text = "текст перед закрытием вкладки " + "x".repeat(40);
    const post = await agent.post(`/api/assessment/tasks/${workId}/draft`).send({ answerText: text });
    assert.equal(post.status, 200);
    assert.equal(post.body.ok, true);
    const task = await agent.get(`/api/assessment/tasks/${workId}`);
    assert.equal(task.body.draftText, text);
  });

  it("POST /draft rejected after work deadline", async () => {
    const agent = await registerCandidate(app, `r60-late-draft-${Date.now()}@demo.local`);
    const { workId, db } = await openWorkAttempt(agent);
    await agent.post(`/api/assessment/tasks/${workId}/draft`).send({ answerText: "вовремя" });
    const expired = new Date(Date.now() - WORK_DEADLINE_MS - 1000).toISOString();
    db.prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      expired,
      expired,
      workId
    );
    const late = await agent.post(`/api/assessment/tasks/${workId}/draft`).send({
      answerText: "после дедлайна",
    });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, "deadline_passed");
    const task = await agent.get(`/api/assessment/tasks/${workId}`);
    assert.equal(task.body.draftText, "вовремя");
  });

  it("POST /draft rejected after submit", async () => {
    const agent = await registerCandidate(app, `r60-submitted-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    await agent
      .post(`/api/assessment/tasks/${workId}/submit`)
      .send({ answerText: answers.workAnswer });
    const res = await agent.post(`/api/assessment/tasks/${workId}/draft`).send({
      answerText: "поздний черновик",
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "already_submitted");
  });

  it("POST /draft not allowed for another candidate", async () => {
    const owner = await registerCandidate(app, `r60-owner-${Date.now()}@demo.local`);
    const other = await registerCandidate(app, `r60-other-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(owner);
    const res = await other.post(`/api/assessment/tasks/${workId}/draft`).send({
      answerText: "чужой",
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "not_found");
  });

  it("lifecycle hide dedupes keepalive to one sendBeacon per hide", () => {
    const storage = new Map();
    const store = {
      setItem(k, v) {
        storage.set(k, v);
      },
      getItem(k) {
        return storage.has(k) ? storage.get(k) : null;
      },
    };
    const beacons = [];
    const lifecycle = createWorkDraftLifecycle({
      attemptId: "att-dedupe",
      taskType: "work",
      getText: () => "flush once",
      storage: store,
      saveDraft: async () => {},
      keepaliveDeps: {
        sendBeacon: () => {
          beacons.push(1);
          return true;
        },
        fetchImpl: null,
      },
    });
    lifecycle.flushOnLifecycleHide();
    lifecycle.flushOnLifecycleHide();
    assert.equal(beacons.length, 1);
  });
});

describe("round60 P3-2 MCP get_task timing fields", () => {
  let app;

  before(() => {
    app = bootApp().app;
  });

  it("get_task returns serverNow and remainingMs for quick task (aligned with REST)", async () => {
    const agent = await registerCandidate(app, `r60-mcp-time-${Date.now()}@demo.local`);
    await agent.put("/api/candidate/profile").send({
      stack: ["node"],
      phone: "+79001234567",
      contactEmail: "m@test.local",
    });
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const userId = (await agent.get("/api/me")).body.id;
    const attemptId = (await agent.get("/api/assessment/battery/current")).body.battery.attempts[0].id;
    const services = require("../app/modules/mcp/services");
    const mcpTask = services.getAssessmentTask(userId, attemptId);
    const restTask = await agent.get(`/api/assessment/tasks/${attemptId}`);
    assert.equal(mcpTask.type, "quick");
    assert.ok(mcpTask.serverNow);
    assert.equal(typeof mcpTask.remainingMs, "number");
    assert.ok(mcpTask.remainingMs > 50_000 && mcpTask.remainingMs <= 60_000);
    assert.ok(restTask.body.serverNow);
    assert.equal(typeof restTask.body.remainingMs, "number");
    const expected = remainingMsUntilDeadline(mcpTask.deadlineAt);
    assert.ok(Math.abs(mcpTask.remainingMs - expected) <= 5);
  });
});
