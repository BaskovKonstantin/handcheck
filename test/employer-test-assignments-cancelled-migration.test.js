"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");
const { newId } = require("../app/lib/ids");

const SCHEMA_PATH = path.join(__dirname, "../app/db/schema.sql");

/** Pre–#62 production DDL: assignments CHECK without `cancelled`. */
function createLegacyEmployerTestTables(db) {
  db.exec(`
    CREATE TABLE employer_tests (
      id TEXT PRIMARY KEY,
      employer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      need_id TEXT NOT NULL REFERENCES employer_needs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_employer_tests_owner ON employer_tests(employer_user_id, updated_at DESC);
    CREATE INDEX idx_employer_tests_need ON employer_tests(need_id, status);

    CREATE TABLE employer_test_items (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES employer_tests(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('text', 'single', 'multi', 'code')),
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      answer_key_json TEXT NOT NULL DEFAULT '{}',
      rubric_keys_json TEXT NOT NULL DEFAULT '{}',
      time_limit_sec INTEGER
    );
    CREATE INDEX idx_employer_test_items_test ON employer_test_items(test_id, position);

    CREATE TABLE employer_test_assignments (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES employer_tests(id) ON DELETE CASCADE,
      candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitation_id TEXT REFERENCES invitations(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'started', 'submitted', 'expired')),
      due_at TEXT NOT NULL,
      started_at TEXT,
      submitted_at TEXT,
      current_item_id TEXT
    );
    CREATE INDEX idx_employer_test_assignments_candidate ON employer_test_assignments(candidate_user_id, status);
    CREATE INDEX idx_employer_test_assignments_test ON employer_test_assignments(test_id);

    CREATE TABLE employer_test_answers (
      assignment_id TEXT NOT NULL REFERENCES employer_test_assignments(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES employer_test_items(id) ON DELETE CASCADE,
      answer_text TEXT NOT NULL DEFAULT '',
      choice_json TEXT NOT NULL DEFAULT '[]',
      auto_ok INTEGER,
      paste_chars INTEGER NOT NULL DEFAULT 0,
      typed_chars INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      submitted_at TEXT,
      timed_out INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (assignment_id, item_id)
    );
  `);
}

function buildLegacyDbWithEmployerTestData(dbPath) {
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const { seed } = require("../app/db/seed");
  seed(db);
  createLegacyEmployerTestTables(db);

  const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
  const annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
  const needId = db
    .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
    .get(cafeId).id;

  const testId = newId();
  const itemId = newId();
  db.prepare(
    `INSERT INTO employer_tests (id, employer_user_id, need_id, title, status)
     VALUES (?, ?, ?, 'Legacy migration test', 'published')`
  ).run(testId, cafeId, needId);
  db.prepare(
    `INSERT INTO employer_test_items (id, test_id, position, kind, prompt)
     VALUES (?, ?, 0, 'text', 'Q1')`
  ).run(itemId, testId);

  const acceptedInvId = newId();
  const sentInvId = newId();
  db.prepare(
    `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
     VALUES (?, ?, ?, ?, 100000, 150000, 'ok', 'email', 'accepted')`
  ).run(acceptedInvId, cafeId, needId, annaId);
  db.prepare(
    `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
     VALUES (?, ?, ?, ?, 100000, 150000, 'pending', 'email', 'sent')`
  ).run(sentInvId, cafeId, needId, annaId);

  const submittedAssignId = newId();
  const openAssignId = newId();
  const due = new Date(Date.now() + 86400000).toISOString();
  const submittedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, invitation_id, status, due_at, submitted_at)
     VALUES (?, ?, ?, ?, 'submitted', ?, ?)`
  ).run(submittedAssignId, testId, annaId, acceptedInvId, due, submittedAt);
  db.prepare(
    `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, invitation_id, status, due_at)
     VALUES (?, ?, ?, ?, 'assigned', ?)`
  ).run(openAssignId, testId, annaId, sentInvId, due);

  db.prepare(
    `INSERT INTO employer_test_answers (assignment_id, item_id, answer_text, submitted_at)
     VALUES (?, ?, 'legacy answer', ?)`
  ).run(submittedAssignId, itemId, submittedAt);

  const legacyDdl = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employer_test_assignments'"
    )
    .get().sql;
  assert.ok(!legacyDdl.includes("'cancelled'"), "fixture must use pre-cancelled CHECK");

  const answerCountBefore = db.prepare("SELECT COUNT(*) AS c FROM employer_test_answers").get().c;
  assert.equal(answerCountBefore, 1);

  db.close();
  return {
    testId,
    itemId,
    submittedAssignId,
    openAssignId,
    answerCountBefore,
  };
}

describe("employer_test_assignments cancelled CHECK migration (legacy DDL)", () => {
  it("preserves answers, cancels open sent-invite assignments, and is idempotent", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `hc-assign-cancel-mig-${process.pid}-${Date.now()}.sqlite`
    );
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const fixture = buildLegacyDbWithEmployerTestData(dbPath);

    const { migrate } = require("../app/db/migrate");
    const db = migrate(dbPath);

    const answerCountAfter = db.prepare("SELECT COUNT(*) AS c FROM employer_test_answers").get().c;
    assert.equal(answerCountAfter, fixture.answerCountBefore);

    const submitted = db
      .prepare("SELECT status, submitted_at FROM employer_test_assignments WHERE id = ?")
      .get(fixture.submittedAssignId);
    assert.equal(submitted.status, "submitted");
    assert.ok(submitted.submitted_at);

    const answer = db
      .prepare(
        "SELECT answer_text, submitted_at FROM employer_test_answers WHERE assignment_id = ? AND item_id = ?"
      )
      .get(fixture.submittedAssignId, fixture.itemId);
    assert.equal(answer.answer_text, "legacy answer");
    assert.ok(answer.submitted_at);

    const open = db
      .prepare("SELECT status FROM employer_test_assignments WHERE id = ?")
      .get(fixture.openAssignId);
    assert.equal(open.status, "cancelled");

    const ddl = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employer_test_assignments'"
      )
      .get().sql;
    assert.ok(ddl.includes("'cancelled'"));

    const cancelledProbeId = newId();
    db.prepare(
      `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, status, due_at)
       VALUES (?, ?, (SELECT id FROM users WHERE email = 'anna@demo.local'), 'cancelled', ?)`
    ).run(cancelledProbeId, fixture.testId, new Date().toISOString());
    db.prepare("DELETE FROM employer_test_assignments WHERE id = ?").run(cancelledProbeId);

    const fkCheck = db.pragma("foreign_key_check");
    assert.deepEqual(fkCheck, []);

    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'employer_test_assignments'"
      )
      .all()
      .map((r) => r.name);
    assert.ok(indexes.includes("idx_employer_test_assignments_candidate"));
    assert.ok(indexes.includes("idx_employer_test_assignments_test"));

    const answerFk = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employer_test_answers'`
      )
      .get().sql;
    assert.match(answerFk, /REFERENCES employer_test_assignments\(id\)/);

    const countsBeforeRerun = {
      answers: db.prepare("SELECT COUNT(*) AS c FROM employer_test_answers").get().c,
      assignments: db.prepare("SELECT COUNT(*) AS c FROM employer_test_assignments").get().c,
    };

    const { applyPatches } = require("../app/db/patches");
    applyPatches(db);

    assert.deepEqual(
      {
        answers: db.prepare("SELECT COUNT(*) AS c FROM employer_test_answers").get().c,
        assignments: db.prepare("SELECT COUNT(*) AS c FROM employer_test_assignments").get().c,
      },
      countsBeforeRerun
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);

    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });
});
