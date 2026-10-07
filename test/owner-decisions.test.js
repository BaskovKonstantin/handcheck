"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const {
  operatorName,
  operatorInn,
  operatorEmail,
  privacyNoticeShort,
} = require("../app/lib/privacy-policy");
const { remainingMsUntilDeadline, deadlineAtIso } = require("../app/lib/assessment-timing");
const {
  registerPayload,
  TEST_ADULT_BIRTH_DATE,
  TEST_MINOR_BIRTH_DATE,
  TEST_TOO_YOUNG_BIRTH_DATE,
} = require("./register-payload");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-owner-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  delete process.env.GRADE_COOLDOWN_DAYS;
  delete process.env.PRIVACY_OPERATOR_NAME;
  delete process.env.PRIVACY_OPERATOR_INN;
  delete process.env.PRIVACY_OPERATOR_EMAIL;
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

describe("owner decisions (FSP)", () => {
  let app;
  let tmpDb;

  before(() => {
    const fresh = freshApp();
    app = fresh.app;
    tmpDb = fresh.tmpDb;
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("GRADE_COOLDOWN_DAYS defaults to 30", () => {
    delete require.cache[require.resolve("../app/config")];
    const cfg = require("../app/config");
    assert.equal(cfg.GRADE_COOLDOWN_DAYS, 30);
  });

  it("privacy notice uses operator defaults without placeholders", () => {
    assert.equal(operatorName(), "Басков Константин Дмитриевич");
    assert.equal(operatorInn(), "781456789012");
    assert.equal(operatorEmail(), "privacy@baski.pro");
    const text = privacyNoticeShort();
    assert.ok(!text.includes("не указан"));
    assert.ok(!text.includes("[УКАЖИТЕ"));
    assert.match(text, /152-ФЗ/);
  });

  it("rejects candidate registration under 15", async () => {
    const email = `young-${Date.now()}@demo.local`;
    const res = await request(app).post("/api/auth/register").send(
      registerPayload({
        email,
        birthDate: TEST_TOO_YOUNG_BIRTH_DATE,
      })
    );
    assert.equal(res.status, 400);
    assert.match(res.body.details.fields.birthDate, /15 лет/);
  });

  it("requires parental consent for candidate 15–17", async () => {
    const email = `minor-${Date.now()}@demo.local`;
    const res = await request(app).post("/api/auth/register").send(
      registerPayload({
        email,
        birthDate: TEST_MINOR_BIRTH_DATE,
        parentalConsent: false,
      })
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.details.fields.parentalConsent);
  });

  it("allows candidate 16 with parental consent and stores consents", async () => {
    const email = `minor-ok-${Date.now()}@demo.local`;
    const res = await request(app).post("/api/auth/register").send(
      registerPayload({
        email,
        birthDate: TEST_MINOR_BIRTH_DATE,
        parentalConsent: true,
      })
    );
    assert.equal(res.status, 201);
    const db = require("../app/db").getDb();
    const user = db.prepare("SELECT birth_date FROM users WHERE email = ?").get(email);
    assert.equal(user.birth_date, TEST_MINOR_BIRTH_DATE);
    const parental = db
      .prepare(
        `SELECT COUNT(*) AS c FROM data_processing_consents WHERE user_id = (SELECT id FROM users WHERE email = ?) AND context = 'parental_registration'`
      )
      .get(email);
    assert.equal(parental.c, 1);
  });

  it("allows adult candidate registration with privacy consent only", async () => {
    const email = `adult-${Date.now()}@demo.local`;
    const res = await request(app).post("/api/auth/register").send(
      registerPayload({ email, birthDate: TEST_ADULT_BIRTH_DATE })
    );
    assert.equal(res.status, 201);
  });

  it("quick task API exposes server remaining time after partial elapsed", async () => {
    const email = `timer-${Date.now()}@demo.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send(registerPayload({ email }));
    await agent.post("/api/auth/confirm").send({ email, code: "000000" });
    await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
    await agent.put("/api/candidate/profile").send({
      displayName: "Timer",
      stack: ["node"],
      phone: "+79001112233",
      contactEmail: email,
    });
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cur = await agent.get("/api/assessment/battery/current");
    const attemptId = cur.body.battery.attempts[0].id;
    await agent.post(`/api/assessment/tasks/${attemptId}/open`);
    const db = require("../app/db").getDb();
    const openedAt = new Date(Date.now() - 25_000).toISOString();
    db.prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      openedAt,
      openedAt,
      attemptId
    );
    const task = await agent.get(`/api/assessment/tasks/${attemptId}`);
    const deadlineAt = deadlineAtIso(openedAt, "quick");
    const expected = remainingMsUntilDeadline(deadlineAt);
    assert.ok(task.body.remainingMs <= 40_000 && task.body.remainingMs >= 30_000);
    assert.ok(Math.abs(task.body.remainingMs - expected) <= 2);
    assert.ok(task.body.serverNow);
  });

  it("failed battery does not remove existing confirmed category", async () => {
    const email = `keep-cat-${Date.now()}@demo.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send(registerPayload({ email }));
    await agent.post("/api/auth/confirm").send({ email, code: "000000" });
    await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
    const db = require("../app/db").getDb();
    const userId = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
    const catRow = db.prepare("SELECT id FROM categories WHERE specialization = 'backend' AND grade = 'middle'").get();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO candidate_categories
       (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
       VALUES (?, ?, 'backend', 'middle', 0.8, 0.8, 0.8, 0.8, ?)`
    ).run(userId, catRow.id, now);
    const batId = require("../app/lib/ids").newId();
    db.prepare(
      `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at, completed_at)
       VALUES (?, ?, 'backend', 'middle', 'A', ?, ?)`
    ).run(batId, userId, now, now);
    const { finalizeBattery } = require("../app/modules/assessment/service");
    const result = finalizeBattery(batId, userId, "middle");
    assert.equal(result.passed, false);
    const still = db.prepare("SELECT grade FROM candidate_categories WHERE candidate_user_id = ?").get(userId);
    assert.equal(still.grade, "middle");
    const catApi = await agent.get("/api/candidate/category");
    assert.equal(catApi.body.status, "confirmed");
    assert.ok(catApi.body.label);
  });

  it("unconfirmed candidates rank below confirmed in deck pool", async () => {
    const { loadCandidatesForNeed } = require("../app/modules/matching/pool");
    const db = require("../app/db").getDb();
    const employerId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const need = db.prepare("SELECT * FROM employer_needs WHERE employer_user_id = ?").get(employerId);
    const unconfId = db.prepare("SELECT id FROM users WHERE email = 'demo-unconf@demo.local'").get()?.id;
    assert.ok(unconfId, "demo-unconf seed");
    const pool = loadCandidatesForNeed(need, employerId, { forDeck: true });
    const unconf = pool.find((c) => c.id === unconfId);
    const confirmed = pool.filter((c) => c.categoryStatus === "confirmed");
    assert.ok(unconf);
    assert.equal(unconf.categoryStatus, "unconfirmed");
    assert.match(unconf.categoryLabel, /неподтверждён/);
    if (confirmed.length) {
      const worstConfirmedRank = Math.min(...confirmed.map((c) => c._rank));
      assert.ok(unconf._rank < worstConfirmedRank);
    }
  });
});
