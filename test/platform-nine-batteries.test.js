"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const { BATTERY_QUICK_COUNT } = require("../app/lib/assessment-timing");
const {
  scoreQuick,
  scoreWork,
  aggregateBattery,
  cutoffForGrade,
  applyBatteryScoreGuards,
  keywordTrapMultiplier,
} = require("../app/lib/rubric-score");
const {
  listPlatformCategories,
  getBatteryDefinition,
  honestAnswersForDefinition,
  keywordTrapQuickAnswers,
  quickRubricFromItem,
} = require("../app/db/battery-catalog");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-nine-${process.pid}-${Date.now()}.sqlite`);
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
    displayName: "Nine Cat",
    stack: ["node"],
    phone: "+79001112244",
    contactEmail: email,
  });
  return agent;
}

describe("platform batteries — 9 categories", () => {
  let app;
  let tmpDb;

  before(() => {
    ({ app, tmpDb } = freshApp());
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  for (const { specialization, grade, label } of listPlatformCategories()) {
    it(`seed: ${label} has 8 quick + 1 work per form A/B`, () => {
      const { getDb } = require("../app/db");
      const db = getDb();
      for (const form of ["A", "B"]) {
        const quick = db
          .prepare(
            `SELECT COUNT(*) AS c FROM tasks WHERE type = 'quick' AND specialization = ? AND grade = ? AND form_key = ? AND status = 'published'`
          )
          .get(specialization, grade, form).c;
        assert.equal(quick, BATTERY_QUICK_COUNT, `${label} form ${form} quick`);
        const work = db
          .prepare(
            `SELECT COUNT(*) AS c FROM tasks WHERE type = 'work' AND specialization = ? AND grade = ? AND form_key = ? AND status = 'published'`
          )
          .get(specialization, grade, form).c;
        assert.equal(work, 1, `${label} form ${form} work`);
      }
    });

    it(`scoring: ${label} honest passes, keyword trap fails cutoff`, () => {
      const def = getBatteryDefinition(specialization, grade);
      const { quickAnswers, workAnswer } = honestAnswersForDefinition(def, grade);
      const honestAttempts = def.quick.map((item, idx) => ({
        id: `honest-${specialization}-${grade}-${idx}`,
        type: "quick",
        answer_text: quickAnswers[idx],
      }));
      const honestRubrics = new Map(
        honestAttempts.map((a, idx) => [a.id, quickRubricFromItem(def.quick[idx], grade, idx)])
      );
      const quickScores = honestAttempts.map((a) =>
        scoreQuick(a.answer_text, honestRubrics.get(a.id))
      );
      const workScore = scoreWork(workAnswer, def.work.rubric);
      let honestAgg = aggregateBattery(quickScores, workScore);
      honestAgg = applyBatteryScoreGuards(honestAgg, honestAttempts, {
        rubricsByAttemptId: honestRubrics,
      });
      assert.ok(
        honestAgg.test_score >= cutoffForGrade(grade),
        `${label} honest ${honestAgg.test_score} < ${cutoffForGrade(grade)}`
      );

      const trapTexts = keywordTrapQuickAnswers(def);
      const trapAttempts = trapTexts.map((text, i) => ({
        id: `trap-${specialization}-${grade}-${i}`,
        type: "quick",
        answer_text: text,
      }));
      const rubricsByAttemptId = new Map(
        trapAttempts.map((a, i) => [
          a.id,
          quickRubricFromItem(def.quick[i], grade, i),
        ])
      );
      const trapQuick = trapAttempts.map((a, i) =>
        scoreQuick(a.answer_text, rubricsByAttemptId.get(a.id))
      );
      let trapAgg = aggregateBattery(trapQuick, workScore);
      trapAgg = applyBatteryScoreGuards(trapAgg, trapAttempts, { rubricsByAttemptId });
      const mult = keywordTrapMultiplier(trapAttempts, rubricsByAttemptId);
      assert.ok(mult < 0.5, `${label} trap mult ${mult}`);
      assert.ok(
        trapAgg.test_score < cutoffForGrade(grade),
        `${label} trap score ${trapAgg.test_score}`
      );
      assert.ok(trapAgg.test_score < honestAgg.test_score);
    });
  }

  it("battery start for frontend junior returns correct category label on pass", async () => {
    const agent = await registerCandidate(app, `fe-jun-${Date.now()}@demo.local`);
    const start = await agent.post("/api/assessment/battery/start").send({
      specialization: "frontend",
      grade: "junior",
      privacyConsent: true,
    });
    assert.equal(start.status, 201);

    const def = getBatteryDefinition("frontend", "junior");
    const { quickAnswers, workAnswer } = honestAnswersForDefinition(def, "junior");
    let cur = await agent.get("/api/assessment/battery/current");
    assert.equal(cur.body.battery.specialization, "frontend");
    assert.equal(cur.body.battery.claimedGrade, "junior");
    const attempts = cur.body.battery.attempts;
    let qi = 0;
    for (const step of attempts) {
      await agent.post(`/api/assessment/tasks/${step.id}/open`);
      const task = await agent.get(`/api/assessment/tasks/${step.id}`);
      const answerText = task.body.type === "work" ? workAnswer : quickAnswers[qi++];
      await agent.post(`/api/assessment/tasks/${step.id}/submit`).send({ answerText });
    }
    const cat = await agent.get("/api/candidate/category");
    assert.equal(cat.body.label, "Frontend × Junior");
  });

  it("cooldown is per specialization (backend fail then frontend start ok)", async () => {
    const email = `cool-spec-${Date.now()}@demo.local`;
    const agent = await registerCandidate(app, email);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "junior",
      privacyConsent: true,
    });
    let cur = await agent.get("/api/assessment/battery/current");
    for (const step of cur.body.battery.attempts) {
      const task = await agent.get(`/api/assessment/tasks/${step.id}`);
      const base = "короткий ответ без нужных тем";
      const answerText =
        task.body.type === "work" ? `${base} ${"подробнее ".repeat(12)}` : base;
      await agent.post(`/api/assessment/tasks/${step.id}/open`);
      await agent.post(`/api/assessment/tasks/${step.id}/submit`).send({ answerText });
    }
    const cat = await agent.get("/api/candidate/category");
    assert.equal(cat.body.label, null);
    assert.ok(cat.body.cooldownActive);

    const feStart = await agent.post("/api/assessment/battery/start").send({
      specialization: "frontend",
      grade: "junior",
      privacyConsent: true,
    });
    assert.equal(feStart.status, 201);
  });
});
