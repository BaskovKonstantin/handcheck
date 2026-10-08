"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { newId } = require("../app/lib/ids");

async function publishMinimalTest(agent, needId, title = "Gate") {
  const created = await agent.post("/api/employer/tests").send({ needId, title, intro: "" });
  await agent.post(`/api/employer/tests/${created.body.id}/items`).send({
    kind: "text",
    prompt: "Q",
    rubricKeys: { keywords: ["a"] },
  });
  await agent.post(`/api/employer/tests/${created.body.id}/publish`);
  return created.body.id;
}

describe("round 90 — company tests require accepted invitation", () => {
  let app;
  let agent;
  let tmpDb;

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `hc-r90-${process.pid}-${Date.now()}.sqlite`);
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

  it("returns 409 when assigning on sent invitation", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 150000, 'test', 'email', 'sent')`
    ).run(invId, cafeId, need.id, anna.id);
    const testId = await publishMinimalTest(agent, need.id);
    const res = await agent.post(`/api/employer/tests/${testId}/assign`).send({
      candidateId: anna.id,
      invitationId: invId,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "invitation_not_accepted");
    assert.match(String(res.body.details?.message || ""), /принят/i);
  });

  it("returns 409 when assigning on declined invitation", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 150000, 'test', 'email', 'declined')`
    ).run(invId, cafeId, need.id, anna.id);
    const testId = await publishMinimalTest(agent, need.id, "Declined gate");
    const res = await agent.post(`/api/employer/tests/${testId}/assign`).send({
      candidateId: anna.id,
      invitationId: invId,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "invitation_not_accepted");
  });

  it("decline cancels open assignment and blocks start; list hides actionable row", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 150000, 'test', 'email', 'sent')`
    ).run(invId, cafeId, need.id, anna.id);
    const testId = await publishMinimalTest(agent, need.id, "Legacy assign");
    const assignId = newId();
    const due = new Date();
    due.setDate(due.getDate() + 2);
    db.prepare(
      `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, invitation_id, status, due_at)
       VALUES (?, ?, ?, ?, 'assigned', ?)`
    ).run(assignId, testId, anna.id, invId, due.toISOString());

    const annaAgent = request.agent(app);
    await annaAgent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    const beforeList = await annaAgent.get("/api/candidate/company-tests");
    assert.ok(!beforeList.body.items.some((x) => x.id === assignId));

    const blockedBeforeDecline = await annaAgent
      .post(`/api/candidate/company-tests/${assignId}/start`)
      .send({});
    assert.equal(blockedBeforeDecline.status, 409);
    assert.equal(blockedBeforeDecline.body.error, "assignment_closed");

    await annaAgent.post(`/api/candidate/invitations/${invId}/decline`).send({});

    const start = await annaAgent.post(`/api/candidate/company-tests/${assignId}/start`).send({});
    assert.equal(start.status, 409);
    assert.equal(start.body.error, "assignment_closed");

    const afterList = await annaAgent.get("/api/candidate/company-tests");
    assert.ok(!afterList.body.items.some((x) => x.id === assignId));

    const invList = await agent.get("/api/employer/invitations");
    const card = invList.body.items.find((i) => i.id === invId);
    assert.equal(card.status, "declined");
    assert.ok(card.companyTests?.some((ct) => ct.status === "cancelled"));
    assert.equal(card.companyTests.find((ct) => ct.id === assignId)?.statusLabel, "Отменён");
  });

  it("allows assign on accepted invitation and second test on same invitation", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 150000, 'test', 'email', 'accepted')`
    ).run(invId, cafeId, need.id, anna.id);
    const testA = await publishMinimalTest(agent, need.id, "Accepted A");
    const testB = await publishMinimalTest(agent, need.id, "Accepted B");
    const a1 = await agent.post(`/api/employer/tests/${testA}/assign`).send({
      candidateId: anna.id,
      invitationId: invId,
    });
    assert.equal(a1.status, 201);
    const a2 = await agent.post(`/api/employer/tests/${testB}/assign`).send({
      candidateId: anna.id,
      invitationId: invId,
    });
    assert.equal(a2.status, 201);
  });
});
