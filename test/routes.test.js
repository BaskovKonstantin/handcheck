"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

describe("HTML routes", () => {
  let app;
  const tmpDb = path.join(os.tmpdir(), `hc-routes-${process.pid}.sqlite`);

  before(() => {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    const { createApp } = require("../app/server");
    app = createApp();
  });

  for (const url of [
    "/candidate/profile",
    "/candidate/integrations",
    "/employer/profile",
    "/employer/integrations",
  ]) {
    it(`GET ${url} returns 200 HTML`, async () => {
      const res = await request(app).get(url);
      assert.equal(res.status, 200);
      assert.match(res.text, /HandCheck/);
    });
  }
});

describe("invitation contacts API", () => {
  let app;
  const tmpDb = path.join(os.tmpdir(), `hc-inv-${process.pid}.sqlite`);

  before(() => {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    const { createApp } = require("../app/server");
    app = createApp();
  });

  it("exposes employer contact email on accepted candidate invitation", async () => {
    const cafe = request.agent(app);
    await cafe.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const { getDb } = require("../app/db");
    const db = getDb();
    const annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
    const need = db
      .prepare(
        "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
      )
      .get();
    db.prepare("DELETE FROM need_reviews WHERE need_id = ? AND candidate_user_id = ?", need.id, annaId);
    const inv = await cafe.post("/api/employer/invitations").send({
      needId: need.id,
      candidateId: annaId,
      salaryFrom: 100000,
      salaryTo: 150000,
      offerText: "Join us",
      contactChannel: "telegram",
    });
    const anna = request.agent(app);
    await anna.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    await anna.post(`/api/candidate/invitations/${inv.body.id}/accept`);
    const list = await anna.get("/api/candidate/invitations");
    const row = list.body.items.find((i) => i.id === inv.body.id);
    assert.ok(row.employerContactEmail, "employerContactEmail");
    const empList = await cafe.get("/api/employer/invitations");
    const erow = empList.body.items.find((i) => i.id === inv.body.id);
    assert.ok(erow.candidatePhone);
    assert.ok(erow.candidateContactEmail);
  });

  it("employer calls list includes timestamps for disambiguation", async () => {
    const cafe = request.agent(app);
    await cafe.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const res = await cafe.get("/api/employer/calls");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    if (res.body.items.length) {
      const row = res.body.items[0];
      assert.ok("invitationAt" in row);
      assert.ok("invitationId" in row);
      assert.ok("endedAt" in row || row.endedAt === null);
    }
  });

  it("returns field error for invalid salary range", async () => {
    const cafe = request.agent(app);
    await cafe.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const db = require("../app/db").getDb();
    const annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
    const need = db
      .prepare(
        "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
      )
      .get();
    const res = await cafe.post("/api/employer/invitations").send({
      needId: need.id,
      candidateId: annaId,
      salaryFrom: 90000,
      salaryTo: 1000,
      offerText: "test",
      contactChannel: "tg",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_body");
    assert.match(res.body.details.fields.salaryRange, /От/);
  });
});
