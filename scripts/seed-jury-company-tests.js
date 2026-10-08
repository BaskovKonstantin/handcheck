#!/usr/bin/env node
"use strict";

/**
 * Idempotent demo seed for jury accounts (employer vacancy tests + reviewable assignments).
 * Usage: DEMO_MODE=1 node scripts/seed-jury-company-tests.js
 */
const path = require("path");
const bcrypt = require("bcryptjs");
const config = require("../app/config");
const { getDb } = require("../app/db");
const { seed } = require("../app/db/seed");
const { newId } = require("../app/lib/ids");
const { getTemplate } = require("../app/modules/employer-tests/templates");
const { insertItem } = require("../app/modules/employer-tests/service");
const JURY_EMPLOYER = "jury@demo.local";
const MARKER_INV = "jury-company-inv-";
const MARKER_TEST = "jury-company-test-";
const MARKER_ASSIGN = "jury-company-asg-";

const CANDIDATES = [
  { email: "jury-backend@demo.local", spec: "backend", cat: "backend_middle", name: "Жюри Backend" },
  { email: "jury-frontend@demo.local", spec: "frontend", cat: "frontend_middle", name: "Жюри Frontend" },
  { email: "jury-qa@demo.local", spec: "qa", cat: "qa_middle", name: "Жюри QA" },
];

const TEMPLATE_BY_SPEC = {
  backend: "backend-api-basics",
  frontend: "frontend-http-api",
  qa: "qa-test-design",
};

const SPEC_TITLE = {
  backend: "Backend",
  frontend: "Frontend",
  qa: "QA",
};

function needTitleForSpec(spec) {
  return `Жюри: ${SPEC_TITLE[spec]} Middle · тест компании`;
}

function ensureUser(db, email, role, { isTest = 1 } = {}) {
  let row = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (row) {
    db.prepare("UPDATE users SET is_test = ? WHERE id = ?").run(isTest, row.id);
    return row.id;
  }
  const hash = bcrypt.hashSync(config.DEMO_PASSWORD, 10);
  const now = new Date().toISOString();
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, email_confirmed_at, created_at, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, email, hash, role, now, now, isTest);
  return id;
}

function findNeedBySpec(db, employerId, spec) {
  const title = needTitleForSpec(spec);
  let need = db
    .prepare(
      `SELECT id, title FROM employer_needs
       WHERE employer_user_id = ? AND specialization = ? AND grade = 'middle' AND title = ?
       LIMIT 1`
    )
    .get(employerId, spec, title);
  if (need) return need;

  need = db
    .prepare(
      `SELECT n.id, n.title FROM employer_needs n
       WHERE n.employer_user_id = ? AND n.specialization = ? AND n.grade = 'middle'
         AND EXISTS (
           SELECT 1 FROM employer_tests t
           WHERE t.need_id = n.id AND t.status = 'published'
         )
       ORDER BY n.title DESC LIMIT 1`
    )
    .get(employerId, spec);
  if (need) return need;

  return db
    .prepare(
      `SELECT id, title FROM employer_needs
       WHERE employer_user_id = ? AND specialization = ? AND grade = 'middle'
       ORDER BY title LIMIT 1`
    )
    .get(employerId, spec);
}

function ensureNeed(db, employerId, spec) {
  const title = needTitleForSpec(spec);
  let need = findNeedBySpec(db, employerId, spec);
  if (!need) {
    const id = newId();
    db.prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
       VALUES (?, ?, ?, ?, 'middle', '[]', '', '', 1)`
    ).run(id, employerId, title, spec);
    need = { id, title };
  }
  return need.id;
}

function ensurePublishedTest(db, employerId, needId, spec) {
  const stableId = `${MARKER_TEST}${spec}`;
  let test = db.prepare("SELECT id FROM employer_tests WHERE id = ?").get(stableId);
  if (test) return test.id;

  test = db
    .prepare(
      `SELECT id FROM employer_tests WHERE employer_user_id = ? AND need_id = ? AND status = 'published' LIMIT 1`
    )
    .get(employerId, needId);
  if (test) return test.id;

  const tplKey = TEMPLATE_BY_SPEC[spec];
  const tpl = getTemplate(tplKey);
  const testId = stableId;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO employer_tests (id, employer_user_id, need_id, title, intro, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'published', ?, ?)`
  ).run(testId, employerId, needId, tpl.title, tpl.intro, now, now);
  let pos = 0;
  for (const item of tpl.items) {
    insertItem(
      db,
      testId,
      {
        kind: item.kind,
        prompt: item.prompt,
        options: item.options || [],
        answerKey: item.answerKey || {},
        rubricKeys: item.rubricKeys || {},
        timeLimitSec: item.timeLimitSec,
      },
      pos
    );
    pos += 1;
  }
  return testId;
}

function seedJuryCompanyTests(db) {
  if (!config.DEMO_MODE) {
    console.error("Set DEMO_MODE=1");
    process.exit(1);
  }
  const employerId = ensureUser(db, JURY_EMPLOYER, "employer", { isTest: 1 });
  const prof = db.prepare("SELECT 1 FROM employer_profiles WHERE user_id = ?").get(employerId);
  if (!prof) {
    db.prepare(
      `INSERT INTO employer_profiles (user_id, company_name, description, industry, contact_email)
       VALUES (?, 'Жюри HandCheck', 'FSP jury', 'IT', ?)`
    ).run(employerId, JURY_EMPLOYER);
  }

  const needs = {};
  for (const spec of ["backend", "frontend", "qa"]) {
    const needId = ensureNeed(db, employerId, spec);
    needs[spec] = needId;
    needs[`${spec}Test`] = ensurePublishedTest(db, employerId, needId, spec);
  }

  for (const c of CANDIDATES) {
    const cid = ensureUser(db, c.email, "candidate", { isTest: 1 });
    if (!db.prepare("SELECT 1 FROM candidate_profiles WHERE user_id = ?").get(cid)) {
      db.prepare(
        `INSERT INTO candidate_profiles (user_id, display_name, stack_json, phone, contact_email, consent_at, availability)
         VALUES (?, ?, '[]', '', ?, datetime('now'), 'open')`
      ).run(cid, c.name, c.email);
    } else {
      db.prepare("UPDATE candidate_profiles SET display_name = ? WHERE user_id = ?").run(c.name, cid);
    }
    if (!db.prepare("SELECT 1 FROM candidate_private WHERE candidate_user_id = ?").get(cid)) {
      db.prepare(
        `INSERT INTO candidate_private (candidate_user_id, integrity, trust_ok) VALUES (?, 0.9, 1)`
      ).run(cid);
    }
    if (!db.prepare("SELECT 1 FROM candidate_categories WHERE candidate_user_id = ?").get(cid)) {
      db.prepare(
        `INSERT INTO candidate_categories
         (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
         VALUES (?, ?, ?, 'middle', 0.7, 0.7, 0.65, 0.8, datetime('now'))`
      ).run(cid, c.cat, c.spec);
    }

    const needId = needs[c.spec];
    const testId = needs[`${c.spec}Test`];
    const invId = `${MARKER_INV}${c.spec}`;
    let inv = db.prepare("SELECT id, status FROM invitations WHERE id = ?").get(invId);
    if (!inv) {
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status, created_at)
         VALUES (?, ?, ?, ?, 220000, 300000, 'Жюри: демо-приглашение для просмотра ответов на тест', 'email', 'accepted', datetime('now', '-1 days'))`
      ).run(invId, employerId, needId, cid);
      inv = { id: invId, status: "accepted" };
    }

    const assignId = `${MARKER_ASSIGN}${c.spec}`;
    const existingAssign = db
      .prepare("SELECT id, status FROM employer_test_assignments WHERE id = ?")
      .get(assignId);
    if (existingAssign?.status === "submitted") continue;

    const dup = db
      .prepare(
        `SELECT id FROM employer_test_assignments WHERE test_id = ? AND candidate_user_id = ? AND status = 'submitted' LIMIT 1`
      )
      .get(testId, cid);
    if (dup && dup.id !== assignId) continue;

    if (existingAssign) {
      db.prepare(
        `UPDATE employer_test_assignments SET invitation_id = ?, test_id = ? WHERE id = ?`
      ).run(inv.id, testId, assignId);
      continue;
    }
    const due = new Date();
    due.setDate(due.getDate() + 3);
    db.prepare(
      `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, invitation_id, status, due_at, started_at, submitted_at)
       VALUES (?, ?, ?, ?, 'submitted', ?, datetime('now'), datetime('now'))`
    ).run(assignId, testId, cid, inv.id, due.toISOString());

    const items = db
      .prepare("SELECT * FROM employer_test_items WHERE test_id = ? ORDER BY position")
      .all(testId);
    for (const it of items) {
      let autoOk = null;
      let answerText = "";
      let choiceJson = "[]";
      if (it.kind === "single" || it.kind === "multi") {
        const key = JSON.parse(it.answer_key_json || "{}");
        choiceJson = JSON.stringify(key.correctIds || []);
        autoOk = 1;
      } else {
        const keys = JSON.parse(it.rubric_keys_json || "{}").keywords || [];
        answerText = `Демо-ответ: ${keys.slice(0, 2).join(", ")}`;
        autoOk = 1;
      }
      db.prepare(
        `INSERT INTO employer_test_answers (assignment_id, item_id, answer_text, choice_json, auto_ok, paste_chars, typed_chars, opened_at, submitted_at)
         VALUES (?, ?, ?, ?, ?, 2, 40, datetime('now'), datetime('now'))`
      ).run(assignId, it.id, answerText, choiceJson, autoOk);
    }
  }

  return { employerEmail: JURY_EMPLOYER, inserted: true };
}

if (require.main === module) {
  process.env.DEMO_MODE = process.env.DEMO_MODE || "1";
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(__dirname, "..", "data", "handcheck.sqlite");
  }
  seed(getDb());
  const result = seedJuryCompanyTests(getDb());
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { seedJuryCompanyTests, JURY_EMPLOYER, needTitleForSpec };
