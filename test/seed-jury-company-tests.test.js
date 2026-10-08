"use strict";

process.env.DEMO_MODE = "1";
process.env.DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo-demo-demo";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { newId } = require("../app/lib/ids");
const { needTitleForSpec } = require("../scripts/seed-jury-company-tests");

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function ensureJuryEmployer(db) {
  let row = db.prepare("SELECT id FROM users WHERE email = ?").get("jury@demo.local");
  if (row) return row.id;
  const bcrypt = require("bcryptjs");
  const config = require("../app/config");
  const id = newId();
  const hash = bcrypt.hashSync(config.DEMO_PASSWORD, 10);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, email_confirmed_at, created_at, is_test)
     VALUES (?, ?, ?, 'employer', ?, ?, 1)`
  ).run(id, "jury@demo.local", hash, now, now);
  db.prepare(
    `INSERT INTO employer_profiles (user_id, company_name, description, industry, contact_email)
     VALUES (?, 'Жюри HandCheck', '', 'IT', 'jury@demo.local')`
  ).run(id);
  return id;
}

function setupProdShapedJuryDb(db) {
  const employerId = ensureJuryEmployer(db);

  const specs = ["backend", "frontend", "qa"];
  const longNeedBySpec = {};
  for (const spec of specs) {
    const shortTitle = `Жюри: ${spec === "backend" ? "Backend" : spec === "frontend" ? "Frontend" : "QA"} Middle`;
    const longTitle = needTitleForSpec(spec);
    const shortId = newId();
    const longId = newId();
    longNeedBySpec[spec] = longId;
    db.prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
       VALUES (?, ?, ?, ?, 'middle', '[]', '', '', 1)`
    ).run(shortId, employerId, shortTitle, spec);
    db.prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
       VALUES (?, ?, ?, ?, 'middle', '[]', '', '', 1)`
    ).run(longId, employerId, longTitle, spec);

    for (const [needId, title] of [
      [shortId, shortTitle],
      [longId, longTitle],
    ]) {
      const testId = newId();
      db.prepare(
        `INSERT INTO employer_tests (id, employer_user_id, need_id, title, intro, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'intro', 'published', datetime('now'), datetime('now'))`
      ).run(testId, employerId, needId, `${title} · опубликован`);
      db.prepare(
        `INSERT INTO employer_test_items (id, test_id, position, kind, prompt, options_json, answer_key_json, rubric_keys_json)
         VALUES (?, ?, 0, 'single', 'q', '[]', '{}', '{}')`
      ).run(newId(), testId);
    }
  }

  const beTest = db
    .prepare("SELECT id FROM employer_tests WHERE need_id = ? AND status = 'published' LIMIT 1")
    .get(longNeedBySpec.backend);
  assert.ok(beTest?.id, "prod-shaped fixture: published backend test missing");
  const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
  assert.ok(anna?.id, "prod-shaped fixture: anna@demo.local missing from seed");
  for (let i = 0; i < 4; i += 1) {
    db.prepare(
      `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, invitation_id, status, due_at)
       VALUES (?, ?, ?, NULL, 'assigned', datetime('now', '+3 days'))`
    ).run(newId(), beTest.id, anna.id);
  }
}

describe("seed-jury-company-tests idempotency (prod-shaped)", () => {
  let tmpDb;

  before(() => {
    tmpDb = path.join(os.tmpdir(), `hc-jury-prodshape-${process.pid}-${Date.now()}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const { createApp } = require("../app/server");
    createApp();
    const { getDb } = require("../app/db");
    const { seed } = require("../app/db/seed");
    seed(getDb());
    setupProdShapedJuryDb(getDb());
  });

  it("does not create extra needs or tests on two runs", () => {
    const { getDb } = require("../app/db");
    const { seedJuryCompanyTests } = require("../scripts/seed-jury-company-tests");
    const db = getDb();
    const needsBefore = countRows(db, "employer_needs");
    const testsBefore = countRows(db, "employer_tests");
    seedJuryCompanyTests(db);
    const needsAfter1 = countRows(db, "employer_needs");
    const testsAfter1 = countRows(db, "employer_tests");
    assert.equal(needsAfter1, needsBefore, "run 1 should not add needs");
    assert.equal(testsAfter1, testsBefore, "run 1 should not add tests");

    seedJuryCompanyTests(db);
    const needsAfter2 = countRows(db, "employer_needs");
    const testsAfter2 = countRows(db, "employer_tests");
    assert.equal(needsAfter2, needsBefore, "run 2 should not add needs");
    assert.equal(testsAfter2, testsBefore, "run 2 should not add tests");
  });
});
