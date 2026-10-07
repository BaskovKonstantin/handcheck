"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const { generateTokenMaterial } = require("../app/lib/api-token");
const { newId } = require("../app/lib/ids");
const { scoreQuick, scoreWork, aggregateBattery, cutoffForGrade } = require("../app/lib/rubric-score");
const { QUICK_RUBRIC, WORK_RUBRIC } = require("../app/db/task-battery-content");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r11-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

describe("round 11 P0 fixes", () => {
  let app;
  let tmpDb;

  before(() => {
    ({ app, tmpDb } = freshApp());
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("rejects REST mutation with read-only API token (P0-2)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    const created = await agent.post("/api/integrations/tokens").send({
      name: "read only",
      scopes: ["read"],
      clientWhere: "Cursor",
      loggingConsent: true,
    });
    assert.equal(created.status, 201);
    const res = await request(app)
      .put("/api/candidate/profile")
      .set("Authorization", `Bearer ${created.body.token}`)
      .send({ displayName: "RO via REST" });
    assert.equal(res.status, 403);
  });

  it("rejects empty salary range on invitation (P0-3)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const needs = await agent.get("/api/employer/needs");
    const needId = needs.body.items[0].id;
    const deck = await agent.get(`/api/employer/needs/${needId}/deck/next`);
    const candidateId = deck.body.candidateId;
    assert.ok(candidateId);
    const res = await agent.post("/api/employer/invitations").send({
      needId,
      candidateId,
      salaryFrom: "",
      salaryTo: "",
      offerText: "Тест",
      contactChannel: "email",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.details.fields.salaryRange, "Укажите вилку зарплаты");
  });

  it("blocks duplicate active invitations (P0-4)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const needId = (await agent.get("/api/employer/needs")).body.items[0].id;
    const { getDb } = require("../app/db");
    const annaId = getDb().prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
    const body = {
      needId,
      candidateId: annaId,
      salaryFrom: 170000,
      salaryTo: 210000,
      offerText: "Предложение",
      contactChannel: "email",
    };
    const first = await agent.post("/api/employer/invitations").send(body);
    assert.equal(first.status, 201);
    const second = await agent.post("/api/employer/invitations").send(body);
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "invitation_duplicate");
  });

  it("invitation response is final after decline (P0-5)", async () => {
    const emp = request.agent(app);
    await emp.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const needId = (await emp.get("/api/employer/needs")).body.items[0].id;
    const { getDb } = require("../app/db");
    const demo3Id = getDb().prepare("SELECT id FROM users WHERE email = 'demo3@demo.local'").get().id;
    const inv = await emp.post("/api/employer/invitations").send({
      needId,
      candidateId: demo3Id,
      salaryFrom: 180000,
      salaryTo: 220000,
      offerText: "Финальный ответ",
      contactChannel: "email",
    });
    assert.equal(inv.status, 201);
    const cand = request.agent(app);
    await cand.post("/api/auth/login").send({
      email: "demo3@demo.local",
      password: "demo-demo-demo",
    });
    await cand.post(`/api/candidate/invitations/${inv.body.id}/decline`);
    const flip = await cand.post(`/api/candidate/invitations/${inv.body.id}/accept`);
    assert.equal(flip.status, 409);
    assert.equal(flip.body.error, "invitation_final");
  });

  it("backend battery tasks are distinct and realistic answers can pass (P0-6)", () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const prompts = db
      .prepare(
        `SELECT prompt FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND form_key = 'A' AND status = 'published' ORDER BY rowid`
      )
      .all()
      .map((r) => r.prompt);
    assert.equal(prompts.length, 8);
    assert.equal(new Set(prompts).size, 8);
    assert.doesNotMatch(prompts.join(" "), /QuickProbe|WorkSim/);

    const realistic = require("../scripts/fixtures/canonical-answer-ab.json").quickAnswer;
    const quickScores = Array.from({ length: 8 }, () => scoreQuick(realistic, QUICK_RUBRIC));
    const workScore = scoreWork(realistic, WORK_RUBRIC);
    const agg = aggregateBattery(quickScores, workScore);
    assert.ok(agg.test_score >= cutoffForGrade("middle"));
  });

  it("returns retakeAt after failed battery without category", async () => {
    const email = `fail-${Date.now()}@demo.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send(registerPayload({ email, role: "candidate" }));
    await agent.post("/api/auth/confirm").send({ email, code: "000000" });
    await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
    await agent.put("/api/candidate/profile").send({
      displayName: "Fail Test",
      stack: ["node"],
      phone: "+79009990000",
      contactEmail: email,
    });
    const start = await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    assert.equal(start.status, 201);
    const battery = await agent.get("/api/assessment/battery/current");
    assert.ok(battery.body.battery);
    for (const step of battery.body.battery.attempts) {
      const task = await agent.get(`/api/assessment/tasks/${step.id}`);
      const base = "короткий ответ без нужных тем";
      const answerText =
        task.body.type === "work" ? `${base} ${"подробнее ".repeat(8)}` : base;
      await agent.post(`/api/assessment/tasks/${step.id}/open`);
      await agent.post(`/api/assessment/tasks/${step.id}/submit`).send({ answerText });
    }
    const cat = await agent.get("/api/candidate/category");
    assert.equal(cat.body.label, null);
    assert.ok(cat.body.retakeAt);
    assert.equal(cat.body.cooldownActive, true);
  });
});

describe("task battery content", () => {
  it("seed has distinct non-placeholder quick prompts", () => {
    const tmpDb = path.join(os.tmpdir(), `hc-seed-${process.pid}-${Date.now()}.sqlite`);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    require("../app/server").createApp();
    const { getDb } = require("../app/db");
    const prompts = getDb()
      .prepare(`SELECT prompt FROM tasks WHERE type = 'quick' AND status = 'published'`)
      .all()
      .map((r) => r.prompt);
    assert.ok(prompts.length >= 9 * 8 * 2);
    assert.equal(new Set(prompts).size, prompts.length);
    assert.doesNotMatch(prompts.join("\n"), /QuickProbe|WorkSim/);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });
});
