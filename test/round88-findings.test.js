"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { newId } = require("../app/lib/ids");
const { keywordHits } = require("../app/lib/russian-keyword-match");
const { COMPANY_ITEM_GRACE_MS, isItemExpired } = require("../app/lib/company-test-timing");

function ensureOpenInvitation(db, employerId, needId, candidateId, status = "accepted") {
  const row = db
    .prepare(
      `SELECT id FROM invitations
       WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?
         AND status IN ('sent', 'viewed', 'accepted')`
    )
    .get(employerId, needId, candidateId);
  if (row) return row.id;
  const id = newId();
  db.prepare(
    `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
     VALUES (?, ?, ?, ?, 100000, 150000, 'test', 'email', ?)`
  ).run(id, employerId, needId, candidateId, status);
  return id;
}

describe("round 88 findings", () => {
  let app;
  let agent;
  let tmpDb;

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `hc-r88-${process.pid}-${Date.now()}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const { createApp } = require("../app/server");
    app = createApp();
    agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
  });

  it("P1-1: late company-test choice is discarded (no auto_ok)", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId);
    ensureOpenInvitation(db, cafeId, need.id, anna.id);
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      templateKey: "backend-api-basics",
    });
    const testId = created.body.id;
    const q1 = db
      .prepare("SELECT id FROM employer_test_items WHERE test_id = ? ORDER BY position LIMIT 1")
      .get(testId);
    await agent.post(`/api/employer/tests/${testId}/publish`);
    const assign = await agent.post(`/api/employer/tests/${testId}/assign`).send({
      candidateId: anna.id,
    });
    const annaAgent = request.agent(app);
    await annaAgent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    await annaAgent.post(`/api/candidate/company-tests/${assign.body.id}/start`).send({});
    const item = db.prepare("SELECT * FROM employer_test_items WHERE id = ?").get(q1.id);
    const openedAt = new Date(Date.now() - 93 * 1000).toISOString();
    db.prepare(
      `UPDATE employer_test_answers SET opened_at = ? WHERE assignment_id = ? AND item_id = ?`
    ).run(openedAt, assign.body.id, q1.id);
    const answerRow = db
      .prepare("SELECT * FROM employer_test_answers WHERE assignment_id = ? AND item_id = ?")
      .get(assign.body.id, q1.id);
    assert.ok(isItemExpired(item, answerRow));
    const late = await annaAgent
      .post(`/api/candidate/company-tests/${assign.body.id}/answers`)
      .send({ itemId: q1.id, choiceId: "a", pasteChars: 3, typedChars: 1 });
    assert.equal(late.status, 200);
    assert.equal(late.body.timedOut, true);
    const stored = db
      .prepare("SELECT auto_ok, timed_out, choice_json FROM employer_test_answers WHERE assignment_id = ? AND item_id = ?")
      .get(assign.body.id, q1.id);
    assert.equal(stored.timed_out, 1);
    assert.notEqual(stored.auto_ok, 1);
    assert.equal(stored.choice_json, "[]");
    const review = await agent.get(`/api/employer/test-assignments/${assign.body.id}`);
    const r1 = review.body.items.find((x) => x.itemId === q1.id);
    assert.equal(r1.timedOut, true);
    assert.notEqual(r1.choiceMark, "ok");
    assert.ok(COMPANY_ITEM_GRACE_MS <= 2000);
  });

  it("P1-2: pool derives invited from open invitation without need_reviews", () => {
    const { getDb } = require("../app/db");
    const { loadCandidatesForNeed, reviewDecisionFor } = require("../app/modules/matching/pool");
    const db = getDb();
    const employerId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const need = db
      .prepare("SELECT * FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(employerId);
    const victor = db.prepare("SELECT id FROM users WHERE email = 'demo3@demo.local'").get();
    db.prepare("DELETE FROM need_reviews WHERE need_id = ? AND candidate_user_id = ?", need.id, victor.id);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 1, 2, 'x', 'email', 'viewed')`
    ).run(invId, employerId, need.id, victor.id);
    assert.equal(reviewDecisionFor(db, employerId, need.id, victor.id), "invited");
    const list = loadCandidatesForNeed(need, employerId, { forDeck: false });
    const row = list.find((c) => c.id === victor.id);
    assert.equal(row?.reviewDecision, "invited");
  });

  it("P1-2: accepted invitation duplicate message", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const employerId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(employerId);
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    ensureOpenInvitation(db, employerId, need.id, anna.id, "accepted");
    const res = await agent.post("/api/employer/invitations").send({
      needId: need.id,
      candidateId: anna.id,
      salaryFrom: 100000,
      salaryTo: 200000,
      offerText: "Повтор",
      contactChannel: "email",
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "invitation_duplicate");
    const dupMsg = String(res.body.details?.message || "");
    assert.match(dupMsg, /уже принял/i);
  });

  it("P2-1: assign without invitation returns 409", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId);
    const galina = db.prepare("SELECT id FROM users WHERE email = 'demo4@demo.local'").get();
    assert.ok(galina?.id, "demo4 candidate missing from seed");
    db.prepare(
      `DELETE FROM invitations WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?`
    ).run(cafeId, need.id, galina.id);
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      title: "Gate",
      intro: "",
    });
    await agent.post(`/api/employer/tests/${created.body.id}/items`).send({
      kind: "text",
      prompt: "Q",
      rubricKeys: { keywords: ["a"] },
    });
    await agent.post(`/api/employer/tests/${created.body.id}/publish`);
    const res = await agent.post(`/api/employer/tests/${created.body.id}/assign`).send({
      candidateId: galina.id,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "invitation_required");
  });

  it("P2-2: blocks re-assign after submitted; invitations list all assignments", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId);
    const invId = ensureOpenInvitation(db, cafeId, need.id, anna.id);
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      title: "Once",
      intro: "",
    });
    const testId = created.body.id;
    await agent.post(`/api/employer/tests/${testId}/items`).send({
      kind: "text",
      prompt: "Q",
      rubricKeys: { keywords: ["done"] },
    });
    await agent.post(`/api/employer/tests/${testId}/publish`);
    const assign = await agent.post(`/api/employer/tests/${testId}/assign`).send({
      candidateId: anna.id,
      invitationId: invId,
    });
    assert.equal(assign.status, 201);
    const annaAgent = request.agent(app);
    await annaAgent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    await annaAgent.post(`/api/candidate/company-tests/${assign.body.id}/start`).send({});
    const item = db
      .prepare("SELECT id FROM employer_test_items WHERE test_id = ? LIMIT 1")
      .get(testId);
    await annaAgent
      .post(`/api/candidate/company-tests/${assign.body.id}/answers`)
      .send({ itemId: item.id, answerText: "done" });
    const dup = await agent.post(`/api/employer/tests/${testId}/assign`).send({
      candidateId: anna.id,
      invitationId: invId,
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, "assignment_duplicate");
    assert.match(String(dup.body.details?.message || ""), /уже прошёл/i);
    const invList = await agent.get("/api/employer/invitations");
    const card = invList.body.items.find((i) => i.id === invId);
    assert.ok(card.companyTests?.length >= 1);
    assert.ok(card.companyTests.some((ct) => ct.status === "submitted"));
  });

  it("P3: Russian keyword stem match for review chips", () => {
    const hits = keywordHits("Мы обновили сервис новой версией API", ["версия"]);
    assert.ok(hits.includes("версия"));
  });
});
