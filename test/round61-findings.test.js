"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const { sendDraftPatchKeepalive } = require("../app/lib/tasks-draft-persist");
const { requireSessionSameOrigin } = require("../app/middleware/session-same-origin");
const { getRequestOrigin } = require("../app/lib/request-origin");
const answers = require("../scripts/fixtures/distinct-quick-answers");

function bootApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r61-${process.pid}-${Date.now()}.sqlite`);
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
  let quickIdx = 0;
  let cur = await agent.get("/api/assessment/battery/current");
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
  return { workId: workStep.id };
}

async function seedDraft(agent, workId, text) {
  const ok = await agent.patch(`/api/assessment/tasks/${workId}/draft`).send({ answerText: text });
  assert.equal(ok.status, 200);
}

async function readDraft(agent, workId) {
  const task = await agent.get(`/api/assessment/tasks/${workId}`);
  return task.body.draftText;
}

describe("round61 P2-1 draft body validation", () => {
  let app;

  before(() => {
    app = bootApp().app;
  });

  it("rejects missing or invalid answerText and leaves stored draft unchanged", async () => {
    const agent = await registerCandidate(app, `r61-bad-body-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    const before = "сохранённый черновик " + "z".repeat(20);
    await seedDraft(agent, workId, before);

    for (const body of [{}, { answerText: null }, { text: "abc" }]) {
      const res = await agent.patch(`/api/assessment/tasks/${workId}/draft`).send(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "invalid_body");
      assert.ok(res.body.details?.fields?.answerText);
      assert.equal(await readDraft(agent, workId), before);
    }
  });

  it("allows explicit empty string (candidate cleared the field)", async () => {
    const agent = await registerCandidate(app, `r61-empty-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    await seedDraft(agent, workId, "было что-то");
    const res = await agent.patch(`/api/assessment/tasks/${workId}/draft`).send({ answerText: "" });
    assert.equal(res.status, 200);
    assert.equal(await readDraft(agent, workId), "");
  });

  it("POST text/plain JSON body is parsed and persisted", async () => {
    const agent = await registerCandidate(app, `r61-plain-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    const text = "из sendBeacon text/plain " + "y".repeat(10);
    const res = await agent
      .post(`/api/assessment/tasks/${workId}/draft`)
      .set("Content-Type", "text/plain")
      .send(JSON.stringify({ answerText: text }));
    assert.equal(res.status, 200);
    assert.equal(await readDraft(agent, workId), text);
  });

  it("POST unparsable text/plain returns 4xx and does not wipe draft", async () => {
    const agent = await registerCandidate(app, `r61-garbage-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    const before = "не трогать " + "q".repeat(15);
    await seedDraft(agent, workId, before);
    const res = await agent
      .post(`/api/assessment/tasks/${workId}/draft`)
      .set("Content-Type", "text/plain")
      .send("not-json");
    assert.equal(res.status, 400);
    assert.equal(await readDraft(agent, workId), before);
  });

  it("sendBeacon keepalive uses application/json Blob (not bare text/plain)", () => {
    const captured = [];
    sendDraftPatchKeepalive("att-beacon-ct", "hello", {
      sendBeacon: (_url, blob) => {
        captured.push(blob);
        return true;
      },
      fetchImpl: null,
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].type, "application/json");
  });
});

describe("round61 P2-2 session same-origin on mutations", () => {
  let app;

  before(() => {
    app = bootApp().app;
  });

  it("foreign Origin on draft PATCH is 403 and draft unchanged", async () => {
    const agent = await registerCandidate(app, `r61-evil-patch-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    const before = "защищённый черновик";
    await seedDraft(agent, workId, before);
    const res = await agent
      .patch(`/api/assessment/tasks/${workId}/draft`)
      .set("Origin", "https://evil.example")
      .send({ answerText: "EVIL2" });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "forbidden");
    assert.equal(await readDraft(agent, workId), before);
  });

  it("matching Origin and tunnel-style host succeed", async () => {
    const agent = await registerCandidate(app, `r61-good-origin-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    const text = "через туннель :8443";
    const res = await agent
      .patch(`/api/assessment/tasks/${workId}/draft`)
      .set("Host", "handcheck.baski.pro:8443")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://handcheck.baski.pro:8443")
      .send({ answerText: text });
    assert.equal(res.status, 200);
    assert.equal(await readDraft(agent, workId), text);
  });

  it("no Origin header still allows draft save (tests and non-browser clients)", async () => {
    const agent = await registerCandidate(app, `r61-no-origin-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    const text = "без Origin";
    const res = await agent.patch(`/api/assessment/tasks/${workId}/draft`).send({ answerText: text });
    assert.equal(res.status, 200);
    assert.equal(await readDraft(agent, workId), text);
  });

  it("Sec-Fetch-Site cross-site is rejected", async () => {
    const agent = await registerCandidate(app, `r61-cross-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    await seedDraft(agent, workId, "hold");
    const res = await agent
      .patch(`/api/assessment/tasks/${workId}/draft`)
      .set("Sec-Fetch-Site", "cross-site")
      .send({ answerText: "x" });
    assert.equal(res.status, 403);
    assert.equal(await readDraft(agent, workId), "hold");
  });

  it("login without Origin still works", async () => {
    const email = `r61-login-${Date.now()}@demo.local`;
    await request(app).post("/api/auth/register").send(registerPayload({ email, role: "candidate" }));
    await request(app).post("/api/auth/confirm").send({ email, code: "000000" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "demo-demo-demo" });
    assert.equal(login.status, 200);
    assert.ok(login.body.ok);
  });

  it("middleware skips Bearer api_token auth (foreign Origin allowed)", () => {
    const calls = [];
    const req = {
      authMethod: "api_token",
      method: "POST",
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    };
    const res = {};
    requireSessionSameOrigin(req, res, (err) => calls.push(err || "ok"));
    assert.deepEqual(calls, ["ok"]);
  });
});

describe("round61 request origin helper", () => {
  it("uses X-Forwarded-Host and proto for tunnel ports", () => {
    const origin = getRequestOrigin({
      headers: { host: "ignored", "x-forwarded-host": "handcheck.baski.pro:8443" },
      secure: true,
    });
    assert.equal(origin, "https://handcheck.baski.pro:8443");
  });
});
