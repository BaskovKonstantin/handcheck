"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const WebSocket = require("ws");
const { registerPayload } = require("./register-payload");
const { INVALID_JSON_BODY_MSG } = require("../app/middleware/errors");
const answers = require("../scripts/fixtures/distinct-quick-answers");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r62-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  const { attachSignaling } = require("../app/modules/calls/signaling");
  const app = createApp();
  const server = http.createServer(app);
  attachSignaling(server);
  return { app, server, tmpDb };
}

function assertInvalidJsonBody(res) {
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_body");
  assert.equal(res.body.details?.message, INVALID_JSON_BODY_MSG);
  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes("Expected property"));
  assert.ok(!raw.includes("Unexpected end of JSON"));
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

function wsRejected(ws) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(ws.readyState !== WebSocket.OPEN), 800);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
    ws.once("error", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function wsOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

describe("round62 P3 malformed application/json", () => {
  let app;

  before(() => {
    app = bootServer().app;
  });

  it("login returns invalid_body without parser English text", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{bad");
    assertInvalidJsonBody(res);
  });

  it("register returns invalid_body without parser English text", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send('{"email":');
    assertInvalidJsonBody(res);
  });

  it("candidate profile PUT returns invalid_body", async () => {
    const agent = await registerCandidate(app, `r62-json-${Date.now()}@demo.local`);
    const res = await agent
      .put("/api/candidate/profile")
      .set("Content-Type", "application/json")
      .send("{");
    assertInvalidJsonBody(res);
  });

  it("assessment draft POST application/json returns invalid_body", async () => {
    const agent = await registerCandidate(app, `r62-draft-json-${Date.now()}@demo.local`);
    const { workId } = await openWorkAttempt(agent);
    const res = await agent
      .post(`/api/assessment/tasks/${workId}/draft`)
      .set("Content-Type", "application/json")
      .send("{bad");
    assertInvalidJsonBody(res);
  });
});

describe("round62 P3 call signaling WebSocket origin", () => {
  let app;
  let server;
  let baseUrl;
  let tmpDb;
  let port;

  before(async () => {
    const boot = bootServer();
    app = boot.app;
    server = boot.server;
    tmpDb = boot.tmpDb;
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  async function seedCall() {
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r62 ws', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(`INSERT INTO calls (id, invitation_id, status) VALUES (?, ?, 'ready')`).run(callId, invId);
    return { callId, cafeCookie: await loginCookie("cafe@demo.local"), annaCookie: await loginCookie("anna@demo.local") };
  }

  async function loginCookie(email) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "demo-demo-demo" }),
    });
    assert.equal(res.status, 200);
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return raw.map((c) => c.split(";")[0]).join("; ");
  }

  const wsUrl = (callId) => `ws://127.0.0.1:${port}/ws/calls/${callId}`;

  it("rejects foreign Origin and does not relay or kick the real tab", async () => {
    const { callId, cafeCookie, annaCookie } = await seedCall();
    const origin = `http://127.0.0.1:${port}`;
    const cafeWs = new WebSocket(wsUrl(callId), {
      headers: { Cookie: cafeCookie, Origin: origin },
    });
    const annaWs = new WebSocket(wsUrl(callId), {
      headers: { Cookie: annaCookie, Origin: origin },
    });
    await Promise.all([wsOpen(cafeWs), wsOpen(annaWs)]);
    const evil = new WebSocket(wsUrl(callId), {
      headers: { Cookie: cafeCookie, Origin: "https://evil.example" },
    });
    assert.equal(await wsRejected(evil), true);
    assert.equal(cafeWs.readyState, WebSocket.OPEN);
    const payload = JSON.stringify({ t: "probe", from: "cafe" });
    const received = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 2000);
      annaWs.once("message", (data) => {
        clearTimeout(timer);
        resolve(String(data));
      });
      cafeWs.send(payload);
    });
    assert.equal(received, payload);
    cafeWs.close();
    annaWs.close();
  });

  it("rejects sibling *.baski.pro Origin", async () => {
    const { callId, cafeCookie } = await seedCall();
    const ws = new WebSocket(wsUrl(callId), {
      headers: { Cookie: cafeCookie, Origin: "https://other.baski.pro" },
    });
    assert.equal(await wsRejected(ws), true);
  });

  it("allows matching Origin on same host", async () => {
    const { callId, cafeCookie, annaCookie } = await seedCall();
    const origin = `http://127.0.0.1:${port}`;
    const ws1 = new WebSocket(wsUrl(callId), {
      headers: { Cookie: cafeCookie, Origin: origin },
    });
    const ws2 = new WebSocket(wsUrl(callId), {
      headers: { Cookie: annaCookie, Origin: origin },
    });
    await Promise.all([wsOpen(ws1), wsOpen(ws2)]);
    const payload = JSON.stringify({ t: "offer", sdp: { type: "offer" } });
    const received = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      ws2.once("message", (data) => {
        clearTimeout(timer);
        resolve(String(data));
      });
      ws1.send(payload);
    });
    assert.equal(received, payload);
    ws1.close();
    ws2.close();
  });

  it("allows SSH tunnel Host/Origin with port 8443", async () => {
    const { callId, cafeCookie } = await seedCall();
    const ws = new WebSocket(wsUrl(callId), {
      headers: {
        Cookie: cafeCookie,
        Host: "handcheck.baski.pro:8443",
        "X-Forwarded-Proto": "https",
        Origin: "https://handcheck.baski.pro:8443",
      },
    });
    await wsOpen(ws);
    ws.close();
  });

  it("allows upgrade without Origin header", async () => {
    const { callId, cafeCookie } = await seedCall();
    const ws = new WebSocket(wsUrl(callId), { headers: { Cookie: cafeCookie } });
    await wsOpen(ws);
    ws.close();
  });

  it("rejects Sec-Fetch-Site cross-site", async () => {
    const { callId, cafeCookie } = await seedCall();
    const ws = new WebSocket(wsUrl(callId), {
      headers: {
        Cookie: cafeCookie,
        Origin: `http://127.0.0.1:${port}`,
        "Sec-Fetch-Site": "cross-site",
      },
    });
    assert.equal(await wsRejected(ws), true);
  });
});
