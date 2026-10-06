"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const request = require("supertest");

const tmpDb = path.join(os.tmpdir(), `hc-match-${process.pid}.sqlite`);
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
process.env.DB_PATH = tmpDb;
process.env.DEMO_MODE = "1";
process.env.DEMO_PASSWORD = "demo-demo-demo";

const { createApp } = require("../app/server");
const { getDb } = require("../app/db");

async function login(agent, email) {
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
}

async function main() {
  const app = createApp();
  const db = getDb();
  db.prepare("DELETE FROM users WHERE email GLOB 'demo[3-9]@demo.local'").run();
  const agent = request.agent(app);
  await login(agent, "cafe@demo.local");

  const need = db
    .prepare("SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')")
    .get();
  db.prepare("DELETE FROM need_reviews WHERE need_id = ?").run(need.id);
  const annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
  const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;

  const matches = await agent.get(`/api/employer/needs/${need.id}/matches`);
  const ids = matches.body.items.map((x) => x.id);
  assert.ok(ids.indexOf(annaId) < ids.indexOf(borisId), "M1 failed: Anna should rank above Boris");
  console.log("M1 pass");

  db.prepare(
    `INSERT INTO candidate_categories (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
     SELECT id, 'frontend_middle', 'frontend', 'middle', 0.9, 0.9, 0.9, 0.9, datetime('now') FROM users WHERE email = 'boris@demo.local'
     ON CONFLICT(candidate_user_id) DO UPDATE SET specialization = 'frontend', grade = 'middle', category_id = 'frontend_middle'`
  ).run();
  const m2 = await agent.get(`/api/employer/needs/${need.id}/matches`);
  assert.ok(!m2.body.items.some((x) => x.id === borisId), "M2 failed");
  console.log("M2 pass");

  db.prepare("UPDATE candidate_private SET trust_ok = 0 WHERE candidate_user_id = ?").run(annaId);
  const m3 = await agent.get(`/api/employer/needs/${need.id}/matches`);
  assert.ok(!m3.body.items.some((x) => x.id === annaId), "M3 failed");
  db.prepare("UPDATE candidate_private SET trust_ok = 1 WHERE candidate_user_id = ?").run(annaId);
  console.log("M3 pass");

  await agent.post(`/api/employer/needs/${need.id}/reviews`).send({
    candidateId: annaId,
    decision: "rejected",
  });
  const deck = await agent.get(`/api/employer/needs/${need.id}/deck/next`);
  assert.ok(!deck.body.card || deck.body.candidateId !== annaId, "M4 deck failed");
  const inv = await agent.post("/api/employer/invitations").send({
    needId: need.id,
    candidateId: annaId,
    salaryFrom: 100,
    salaryTo: 200,
    offerText: "hi",
    contactChannel: "tg",
  });
  assert.equal(inv.status, 409, "M4 invite should fail for rejected");
  console.log("M4 pass");

  db.prepare("DELETE FROM need_reviews WHERE candidate_user_id = ? AND need_id = ?", annaId, need.id);
  await agent.post(`/api/employer/needs/${need.id}/reviews`).send({
    candidateId: borisId,
    decision: "later",
  });
  const inv2 = await agent.post("/api/employer/invitations").send({
    needId: need.id,
    candidateId: borisId,
    salaryFrom: 100,
    salaryTo: 200,
    offerText: "hi",
    contactChannel: "tg",
  });
  assert.ok(inv2.status >= 400, "M5 invite should not succeed for later");
  const def = await agent.get(`/api/employer/needs/${need.id}/deferred`);
  assert.ok(def.body.items.some((x) => x.candidateId === borisId), "M5 deferred");
  db.prepare(
    `UPDATE candidate_categories SET category_id = 'backend_middle', specialization = 'backend', grade = 'middle'
     WHERE candidate_user_id = ?`
  ).run(borisId);
  await agent.delete(`/api/employer/needs/${need.id}/reviews/${borisId}`);
  const deck2 = await agent.get(`/api/employer/needs/${need.id}/deck/next`);
  assert.equal(deck2.body.candidateId, borisId, "M5 return to deck");
  console.log("M5 pass");

  const m6 = await agent.get(`/api/employer/needs/${need.id}/matches`);
  for (const item of m6.body.items) {
    for (const line of item.explanation) {
      assert.ok(!/\d/.test(line), `M6 failed: digit in "${line}"`);
    }
  }
  console.log("M6 pass");
  console.log("validate-matching: all pass");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
