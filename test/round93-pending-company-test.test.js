"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

async function publishMinimalTest(agent, needId, title) {
  const created = await agent.post("/api/employer/tests").send({ needId, title, intro: "" });
  await agent.post(`/api/employer/tests/${created.body.id}/items`).send({
    kind: "text",
    prompt: "Q",
    rubricKeys: { keywords: ["a"] },
  });
  await agent.post(`/api/employer/tests/${created.body.id}/publish`);
  return created.body.id;
}

async function inviteWithTest(employerAgent, needId, candidateId, testId, title) {
  return employerAgent.post("/api/employer/invitations").send({
    needId,
    candidateId,
    salaryFrom: 100000,
    salaryTo: 150000,
    offerText: `Offer ${title}`,
    contactChannel: "email",
    employerTestId: testId,
  });
}

describe("round 93 — pending company test on invitation", () => {
  let app;
  let employer;
  let candidate;
  let tmpDb;
  let needId;
  const candidateIds = {};

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `hc-r93-${process.pid}-${Date.now()}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const { createApp } = require("../app/server");
    app = createApp();
    employer = request.agent(app);
    candidate = request.agent(app);
    await employer.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    await candidate.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    const db = require("../app/db").getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    for (const email of ["anna@demo.local", "demo4@demo.local", "demo3@demo.local"]) {
      candidateIds[email] = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
    }
    needId = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
      .get(cafeId).id;
  });

  it("employer and candidate see pending test before accept", async () => {
    const annaId = candidateIds["anna@demo.local"];
    const testTitle = "Очередь до принятия";
    const testId = await publishMinimalTest(employer, needId, testTitle);
    const inv = await inviteWithTest(employer, needId, annaId, testId, testTitle);
    assert.equal(inv.status, 201);
    const invitationId = inv.body.id;

    const empList = await employer.get("/api/employer/invitations");
    const card = empList.body.items.find((i) => i.id === invitationId);
    assert.ok(card);
    const pending = card.companyTests.find((ct) => ct.status === "pending_accept");
    assert.ok(pending);
    assert.equal(pending.title, testTitle);
    assert.match(pending.pendingMessage, /назначится после принятия/i);
    assert.ok(pending.pendingMessage.includes(testTitle));

    const candList = await candidate.get("/api/candidate/invitations");
    const row = candList.body.items.find((i) => i.id === invitationId);
    assert.ok(row);
    assert.equal(row.pendingCompanyTestTitle, testTitle);
    assert.match(row.pendingCompanyTestNote, /откроется тест компании/i);
    assert.ok(row.pendingCompanyTestNote.includes(testTitle));

    const companyBefore = await candidate.get("/api/candidate/company-tests");
    assert.ok(!companyBefore.body.items.some((x) => x.title === testTitle));
  });

  it("after accept pending becomes assigned for both roles", async () => {
    const galinaId = candidateIds["demo4@demo.local"];
    const galina = request.agent(app);
    await galina.post("/api/auth/login").send({
      email: "demo4@demo.local",
      password: "demo-demo-demo",
    });
    const testTitle = "После принятия назначен";
    const testId = await publishMinimalTest(employer, needId, testTitle);
    const inv = await inviteWithTest(employer, needId, galinaId, testId, testTitle);
    assert.equal(inv.status, 201);
    const invitationId = inv.body.id;

    await galina.post(`/api/candidate/invitations/${invitationId}/accept`).send({});

    const empList = await employer.get("/api/employer/invitations");
    const card = empList.body.items.find((i) => i.id === invitationId);
    assert.ok(card, "employer invitation card");
    assert.ok(!card.companyTests.some((ct) => ct.status === "pending_accept"));
    assert.ok(card.companyTests.some((ct) => ct.status === "assigned" && ct.title === testTitle));

    const candList = await galina.get("/api/candidate/invitations");
    const row = candList.body.items.find((i) => i.id === invitationId);
    assert.equal(row.pendingCompanyTestNote, undefined);

    const company = await galina.get("/api/candidate/company-tests");
    assert.ok(company.body.items.some((x) => x.title === testTitle));
  });

  it("after decline pending row is hidden and no assignment is created", async () => {
    const victorId = candidateIds["demo3@demo.local"];
    const victor = request.agent(app);
    await victor.post("/api/auth/login").send({
      email: "demo3@demo.local",
      password: "demo-demo-demo",
    });
    const testTitle = "Отказ без теста";
    const testId = await publishMinimalTest(employer, needId, testTitle);
    const inv = await inviteWithTest(employer, needId, victorId, testId, testTitle);
    const invitationId = inv.body.id;

    await victor.post(`/api/candidate/invitations/${invitationId}/decline`).send({});

    const empList = await employer.get("/api/employer/invitations");
    const card = empList.body.items.find((i) => i.id === invitationId);
    assert.equal(card.status, "declined");
    assert.ok(!card.companyTests.some((ct) => ct.status === "pending_accept"));
    assert.ok(!card.companyTests.some((ct) => ct.title === testTitle && ct.status === "assigned"));

    const candList = await victor.get("/api/candidate/invitations");
    const row = candList.body.items.find((i) => i.id === invitationId);
    assert.equal(row.pendingCompanyTestNote, undefined);

    const company = await victor.get("/api/candidate/company-tests");
    assert.ok(!company.body.items.some((x) => x.title === testTitle));
  });
});
