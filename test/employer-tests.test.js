"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

describe("employer vacancy tests (constructor)", () => {
  let app;
  let agent;
  const tmpDb = path.join(os.tmpdir(), `hc-emp-tests-${process.pid}.sqlite`);

  before(async () => {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    const { createApp } = require("../app/server");
    app = createApp();
    agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
  });

  it("rejects test creation for another employer need", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeNeed = db
      .prepare(
        "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
      )
      .get();
    const otherEmp = request.agent(app);
    await otherEmp.post("/api/auth/login").send({ email: "other@demo.local", password: "demo-demo-demo" });
    const res = await otherEmp.post("/api/employer/tests").send({
      needId: cafeNeed.id,
      title: "Чужой тест",
    });
    assert.equal(res.status, 404);
  });

  it("creates from template, edits, publishes, archives", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')")
      .get();
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      templateKey: "backend-api-basics",
    });
    assert.equal(created.status, 201);
    const testId = created.body.id;
    const detail = await agent.get(`/api/employer/tests/${testId}`);
    assert.ok(detail.body.items.length >= 4);

    const otherEmp = request.agent(app);
    await otherEmp.post("/api/auth/login").send({ email: "other@demo.local", password: "demo-demo-demo" });
    const forbidden = await otherEmp.get(`/api/employer/tests/${testId}`);
    assert.equal(forbidden.status, 404);

    const pub = await agent.post(`/api/employer/tests/${testId}/publish`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.status, "published");

    const editBlocked = await agent.put(`/api/employer/tests/${testId}`).send({ title: "X" });
    assert.equal(editBlocked.status, 409);

    const archived = await agent.delete(`/api/employer/tests/${testId}`);
    assert.equal(archived.status, 200);
  });

  it("blocks assign for unconfirmed candidate", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const need = db
      .prepare(
        "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
      )
      .get();
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      templateKey: "qa-test-design",
    });
    const testId = created.body.id;
    await agent.post(`/api/employer/tests/${testId}/publish`);
    const unconf = db.prepare("SELECT id FROM users WHERE email = 'demo-unconf@demo.local'").get();
    const res = await agent.post(`/api/employer/tests/${testId}/assign`).send({ candidateId: unconf.id });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "candidate_unconfirmed");
  });

  it("advances on per-question time expiry instead of locking the test", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const need = db
      .prepare(
        "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
      )
      .get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      title: "Timed",
      intro: "",
    });
    const testId = created.body.id;
    const item1 = await agent.post(`/api/employer/tests/${testId}/items`).send({
      kind: "text",
      prompt: "Fast",
      rubricKeys: { keywords: ["x"] },
      timeLimitSec: 30,
    });
    const item2 = await agent.post(`/api/employer/tests/${testId}/items`).send({
      kind: "text",
      prompt: "Second",
      rubricKeys: { keywords: ["y"] },
      timeLimitSec: 120,
    });
    await agent.post(`/api/employer/tests/${testId}/publish`);
    const assign = await agent.post(`/api/employer/tests/${testId}/assign`).send({ candidateId: anna.id });
    const annaAgent = request.agent(app);
    await annaAgent.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });
    await annaAgent.post(`/api/candidate/company-tests/${assign.body.id}/start`).send({});
    db.prepare(
      `UPDATE employer_test_answers SET opened_at = datetime('now', '-2 minutes') WHERE assignment_id = ? AND item_id = ?`
    ).run(assign.body.id, item1.body.id);
    const late = await annaAgent
      .post(`/api/candidate/company-tests/${assign.body.id}/answers`)
      .send({ itemId: item1.body.id, answerText: "x" });
    assert.equal(late.status, 200);
    assert.equal(late.body.timedOut, true);
    const view = await annaAgent.get(`/api/candidate/company-tests/${assign.body.id}`);
    assert.equal(view.body.currentItemId, item2.body.id);
    await annaAgent
      .post(`/api/candidate/company-tests/${assign.body.id}/answers`)
      .send({ itemId: item2.body.id, answerText: "y keyword answer" });
    const submit = await annaAgent.post(`/api/candidate/company-tests/${assign.body.id}/submit`).send({});
    assert.equal(submit.status, 200);
  });

  it("GET assignment does not start timer until POST start", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const need = db
      .prepare(
        "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
      )
      .get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      title: "No auto start",
      intro: "",
    });
    const testId = created.body.id;
    await agent.post(`/api/employer/tests/${testId}/items`).send({
      kind: "text",
      prompt: "Q",
      rubricKeys: { keywords: ["a"] },
      timeLimitSec: 60,
    });
    await agent.post(`/api/employer/tests/${testId}/publish`);
    const assign = await agent.post(`/api/employer/tests/${testId}/assign`).send({ candidateId: anna.id });
    const annaAgent = request.agent(app);
    await annaAgent.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });
    const peek = await annaAgent.get(`/api/candidate/company-tests/${assign.body.id}`);
    assert.equal(peek.body.status, "assigned");
    assert.equal(peek.body.items[0].openedAt, null);
    await annaAgent.post(`/api/candidate/company-tests/${assign.body.id}/start`).send({});
    const started = await annaAgent.get(`/api/candidate/company-tests/${assign.body.id}`);
    assert.ok(started.body.items[0].openedAt);
  });

  it("links assignment to invitationId and rejects duplicate open assign", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId);
    const invId = require("../app/lib/ids").newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 150000, 'test', 'email', 'accepted')`
    ).run(invId, cafeId, need.id, anna.id);
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      title: "Invite link test",
      intro: "",
    });
    const testId = created.body.id;
    await agent.post(`/api/employer/tests/${testId}/items`).send({
      kind: "text",
      prompt: "Q",
      rubricKeys: { keywords: ["a"] },
    });
    await agent.post(`/api/employer/tests/${testId}/publish`);
    const assign = await agent.post(`/api/employer/tests/${testId}/assign`).send({
      candidateId: anna.id,
      invitationId: invId,
    });
    assert.equal(assign.status, 201);
    const row = db
      .prepare("SELECT invitation_id FROM employer_test_assignments WHERE id = ?")
      .get(assign.body.id);
    assert.equal(row.invitation_id, invId);
    const dup = await agent.post(`/api/employer/tests/${testId}/assign`).send({
      candidateId: anna.id,
      invitationId: invId,
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, "assignment_duplicate");
  });

  it("frontend template first question differs from backend", () => {
    const { getTemplate } = require("../app/modules/employer-tests/templates");
    const be = getTemplate("backend-api-basics").items[0].prompt;
    const fe = getTemplate("frontend-http-api").items[0].prompt;
    assert.notEqual(be, fe);
    assert.match(fe, /CORS|fetch|origin/i);
  });

  it("reorders items on draft", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')")
      .get();
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      title: "Reorder me",
      intro: "",
    });
    const testId = created.body.id;
    const a = await agent.post(`/api/employer/tests/${testId}/items`).send({
      kind: "text",
      prompt: "A",
      rubricKeys: { keywords: ["a"] },
      timeLimitSec: 60,
    });
    const b = await agent.post(`/api/employer/tests/${testId}/items`).send({
      kind: "text",
      prompt: "B",
      rubricKeys: { keywords: ["b"] },
      timeLimitSec: 60,
    });
    const order = [b.body.id, a.body.id];
    const re = await agent.post(`/api/employer/tests/${testId}/items/reorder`).send({ order });
    assert.equal(re.status, 200);
    const detail = await agent.get(`/api/employer/tests/${testId}`);
    assert.equal(detail.body.items[0].id, b.body.id);
  });
});
