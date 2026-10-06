"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const answers = require("../scripts/fixtures/canonical-answer-ab.json");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r14-${process.pid}-${Date.now()}.sqlite`);
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
  await agent.post("/api/auth/register").send({
    email,
    password: "demo-demo-demo",
    role: "candidate",
  });
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  return agent;
}

describe("round 14 P0 regressions", () => {
  let app;
  let tmpDb;

  before(() => {
    ({ app, tmpDb } = freshApp());
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("P0-1: cannot resubmit answers after battery completes", async () => {
    const email = `r14c-${Date.now()}@demo.local`;
    const agent = await registerCandidate(app, email);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const battery = await agent.get("/api/assessment/battery/current");
    const attempts = battery.body.battery.attempts;
    for (const a of attempts) {
      await agent.post(`/api/assessment/tasks/${a.id}/open`);
      await agent.post(`/api/assessment/tasks/${a.id}/submit`).send({
        answerText: "не знаю",
      });
    }
    const cat = await agent.get("/api/candidate/category");
    assert.equal(cat.body.label, null);
    const firstId = attempts[0].id;
    const again = await agent.post(`/api/assessment/tasks/${firstId}/submit`).send({
      answerText: answers.quickAnswer,
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "already_submitted");
    const draft = await agent.patch(`/api/assessment/tasks/${firstId}/draft`).send({
      answerText: "hack",
    });
    assert.equal(draft.status, 409);
  });

  it("P0-2/P0-3: call lifecycle and recording side", async () => {
    const cafe = request.agent(app);
    await cafe.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const needId = (await cafe.get("/api/employer/needs")).body.items[0].id;
    const demo3Id = require("../app/db").getDb().prepare("SELECT id FROM users WHERE email = 'demo3@demo.local'").get()
      .id;
    const inv = await cafe.post("/api/employer/invitations").send({
      needId,
      candidateId: demo3Id,
      salaryFrom: 90000,
      salaryTo: 120000,
      offerText: "Тест звонка",
      contactChannel: "email",
    });
    const anna = request.agent(app);
    await anna.post("/api/auth/login").send({ email: "demo3@demo.local", password: "demo-demo-demo" });
    await anna.post(`/api/candidate/invitations/${inv.body.id}/accept`);
    const info = await cafe.get(`/api/calls/for-invitation/${inv.body.id}`);
    const callId = info.body.callId;
    const endEarly = await cafe.post(`/api/calls/${callId}/end`);
    assert.equal(endEarly.status, 409);
    const analysisEarly = await cafe.get(`/api/calls/${callId}/analysis`);
    assert.equal(analysisEarly.status, 404);
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
    const badUpload = await anna
      .post(`/api/calls/${callId}/recording`)
      .field("side", "employer")
      .attach("file", webm, { filename: "x.webm", contentType: "video/webm" });
    assert.equal(badUpload.status, 409);
    const textUpload = await anna
      .post(`/api/calls/${callId}/recording`)
      .field("side", "candidate")
      .attach("file", Buffer.from("hello"), { filename: "x.txt", contentType: "text/plain" });
    assert.ok([400, 409].includes(textUpload.status));
  });

  it("P0-4: register and profile validation", async () => {
    const bad = await request(app).post("/api/auth/register").send({
      email: "nope",
      password: "x",
      role: "candidate",
    });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.fields.email);
    const agent = await registerCandidate(app, `r14p-${Date.now()}@demo.local`);
    const wipe = await agent.put("/api/candidate/profile").send({ displayName: "Остаётся" });
    assert.equal(wipe.status, 200);
    const prof = await agent.get("/api/candidate/profile");
    assert.ok(prof.body.contactEmail);
    const bg = await agent.post("/api/candidate/background").send({});
    assert.equal(bg.status, 400);
  });
});
