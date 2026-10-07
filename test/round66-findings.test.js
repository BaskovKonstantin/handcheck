"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { buildExplanation } = require("../app/modules/matching/explain");
const { registerPayload } = require("./register-payload");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r66-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

function seedEmployerNeed(db) {
  const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
  const need = db.prepare("SELECT * FROM employer_needs WHERE employer_user_id = ?").get(cafeId);
  return { employerId: cafeId, need };
}

async function registerEligibleCandidate(app, email, displayName) {
  await request(app).post("/api/auth/register").send(registerPayload({ email }));
  await request(app).post("/api/auth/confirm").send({ email, code: "000000" });
  const db = require("../app/db").getDb();
  const userId = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
  db.prepare(
    "UPDATE candidate_profiles SET display_name = ?, stack_json = ? WHERE user_id = ?"
  ).run(displayName, JSON.stringify(["node"]), userId);
  db.prepare(
    "INSERT OR IGNORE INTO candidate_private (candidate_user_id, integrity, trust_ok) VALUES (?, 0.2, 1)"
  ).run(userId);
  return userId;
}

function assignCategory(db, userId, specialization, grade, scores = {}) {
  const catRow = db
    .prepare("SELECT id, label FROM categories WHERE specialization = ? AND grade = ?")
    .get(specialization, grade);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO candidate_categories
     (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(candidate_user_id) DO UPDATE SET
       category_id = excluded.category_id,
       specialization = excluded.specialization,
       grade = excluded.grade,
       test_score = excluded.test_score,
       knowledge = excluded.knowledge,
       breadth = excluded.breadth,
       motivation = excluded.motivation,
       assigned_at = excluded.assigned_at`
  ).run(
    userId,
    catRow.id,
    specialization,
    grade,
    scores.test_score ?? 0.9,
    scores.knowledge ?? 0.8,
    scores.breadth ?? 0.8,
    scores.motivation ?? 0.85,
    now
  );
  return catRow.label;
}

describe("round66 P2-1 cross-grade confirmed pool labels", () => {
  it("explains exact, lower, higher, and unconfirmed grades honestly", () => {
    const need = { specialization: "backend", grade: "middle", stack_json: "[]", domain_text: "" };
    const exact = buildExplanation(
      { gradeRelation: "exact", confirmedGrade: "middle", categoryStatus: "confirmed", domain_boost: 0, fsp_boost: 0, stack: [] },
      need
    );
    assert.match(exact[0], /Категория совпадает с потребностью: Backend × Middle/);

    const lower = buildExplanation(
      { gradeRelation: "lower", confirmedGrade: "junior", categoryStatus: "confirmed", domain_boost: 0, fsp_boost: 0, stack: [] },
      need
    );
    assert.equal(lower[0], "Грейд ниже потребности: Junior vs Middle");

    const higher = buildExplanation(
      { gradeRelation: "higher", confirmedGrade: "senior", categoryStatus: "confirmed", domain_boost: 0, fsp_boost: 0, stack: [] },
      need
    );
    assert.equal(higher[0], "Грейд выше потребности: Senior vs Middle");

    const unconf = buildExplanation(
      { gradeRelation: "unconfirmed", confirmedGrade: null, categoryStatus: "unconfirmed", domain_boost: 0, fsp_boost: 0, stack: [] },
      need
    );
    assert.match(unconf[0], /не подтверждена тестом/);
    assert.ok(!unconf[0].includes("совпадает"));
  });

  it("pool shows real confirmed label for off-grade candidates on middle need", async () => {
    const { app } = freshApp();
    const db = require("../app/db").getDb();
    const { employerId, need } = seedEmployerNeed(db);
    const { loadCandidatesForNeed } = require("../app/modules/matching/pool");

    const juniorEmail = `r66-junior-${Date.now()}@demo.local`;
    const seniorEmail = `r66-senior-${Date.now()}@demo.local`;
    const unconfEmail = `r66-unconf-${Date.now()}@demo.local`;
    const juniorId = await registerEligibleCandidate(app, juniorEmail, "R66 Junior");
    const seniorId = await registerEligibleCandidate(app, seniorEmail, "R66 Senior");
    const unconfId = await registerEligibleCandidate(app, unconfEmail, "R66 Unconf");
    const juniorLabel = assignCategory(db, juniorId, "backend", "junior");
    const seniorLabel = assignCategory(db, seniorId, "backend", "senior");

    const pool = loadCandidatesForNeed(need, employerId);
    const junior = pool.find((c) => c.id === juniorId);
    const senior = pool.find((c) => c.id === seniorId);
    const unconf = pool.find((c) => c.id === unconfId);

    assert.ok(junior, "junior confirmed in pool");
    assert.equal(junior.categoryLabel, juniorLabel);
    assert.equal(junior.categoryStatus, "confirmed");
    assert.equal(junior.gradeRelation, "lower");
    assert.equal(junior.explanation[0], "Грейд ниже потребности: Junior vs Middle");

    assert.ok(senior, "senior confirmed in pool");
    assert.equal(senior.categoryLabel, seniorLabel);
    assert.equal(senior.categoryStatus, "confirmed");
    assert.equal(senior.gradeRelation, "higher");
    assert.equal(senior.explanation[0], "Грейд выше потребности: Senior vs Middle");

    assert.ok(unconf);
    assert.equal(unconf.categoryStatus, "unconfirmed");
    assert.match(unconf.categoryLabel, /неподтверждён/);
    assert.match(unconf.explanation[0], /не подтверждена тестом/);
  });

  it("ranks exact confirmed above off-grade confirmed above unconfirmed", async () => {
    const { app } = freshApp();
    const db = require("../app/db").getDb();
    const { employerId, need } = seedEmployerNeed(db);
    const { loadCandidatesForNeed } = require("../app/modules/matching/pool");

    const annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
    const juniorId = await registerEligibleCandidate(
      app,
      `r66-rank-j-${Date.now()}@demo.local`,
      "R66 Rank Junior"
    );
    const unconfId = await registerEligibleCandidate(
      app,
      `r66-rank-u-${Date.now()}@demo.local`,
      "R66 Rank Unconf"
    );
    assignCategory(db, juniorId, "backend", "junior", { test_score: 0.99 });

    const pool = loadCandidatesForNeed(need, employerId);
    const anna = pool.find((c) => c.id === annaId);
    const junior = pool.find((c) => c.id === juniorId);
    const unconf = pool.find((c) => c.id === unconfId);
    assert.ok(anna && junior && unconf);

    const annaIdx = pool.findIndex((c) => c.id === annaId);
    const juniorIdx = pool.findIndex((c) => c.id === juniorId);
    const unconfIdx = pool.findIndex((c) => c.id === unconfId);
    assert.ok(annaIdx < juniorIdx, "exact middle before off-grade junior");
    assert.ok(juniorIdx < unconfIdx, "off-grade confirmed before unconfirmed");
  });

  it("employer matches API exposes gradeRelation for MCP/UI parity", async () => {
    const { app } = freshApp();
    const db = require("../app/db").getDb();
    const { need } = seedEmployerNeed(db);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });

    const juniorId = await registerEligibleCandidate(
      app,
      `r66-api-j-${Date.now()}@demo.local`,
      "R66 API Junior"
    );
    assignCategory(db, juniorId, "backend", "junior");

    const res = await agent.get(`/api/employer/needs/${need.id}/matches`);
    assert.equal(res.status, 200);
    const row = res.body.items.find((c) => c.id === juniorId);
    assert.ok(row);
    assert.equal(row.categoryStatus, "confirmed");
    assert.equal(row.gradeRelation, "lower");
    assert.equal(row.explanation[0], "Грейд ниже потребности: Junior vs Middle");
  });
});
