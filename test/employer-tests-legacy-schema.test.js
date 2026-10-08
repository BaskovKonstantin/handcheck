"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

describe("employer_test_answers opened_at patch (legacy #52 DB)", () => {
  let app;
  const tmpDb = path.join(os.tmpdir(), `hc-legacy-emp-answers-${process.pid}.sqlite`);

  before(() => {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    const { createApp } = require("../app/server");
    app = createApp();
    const db = require("../app/db").getDb();
    db.exec("DROP TABLE IF EXISTS employer_test_answers");
    db.exec(`
      CREATE TABLE employer_test_answers (
        assignment_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        answer_text TEXT NOT NULL DEFAULT '',
        choice_json TEXT NOT NULL DEFAULT '[]',
        auto_ok INTEGER,
        paste_chars INTEGER NOT NULL DEFAULT 0,
        typed_chars INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT,
        PRIMARY KEY (assignment_id, item_id)
      )
    `);
    const { applyPatches } = require("../app/db/patches");
    applyPatches(db);
    const cols = db.prepare("PRAGMA table_info(employer_test_answers)").all().map((c) => c.name);
    assert.ok(cols.includes("opened_at"), "opened_at column must be added by patch");
  });

  it("POST start succeeds after legacy schema migration", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const db = require("../app/db").getDb();
    const need = db
      .prepare(
        "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
      )
      .get();
    const created = await agent.post("/api/employer/tests").send({
      needId: need.id,
      templateKey: "backend-api-basics",
    });
    const testId = created.body.id;
    await agent.post(`/api/employer/tests/${testId}/publish`);
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 150000, 'legacy', 'email', 'accepted')`
    ).run(invId, cafeId, need.id, annaId);
    const assign = await agent
      .post(`/api/employer/tests/${testId}/assign`)
      .send({ candidateId: annaId, invitationId: invId });
    assert.equal(assign.status, 201);
    const anna = request.agent(app);
    await anna.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });
    const start = await anna.post(`/api/candidate/company-tests/${assign.body.id}/start`).send({});
    assert.equal(start.status, 200);
    assert.equal(start.body.status, "started");
  });
});
