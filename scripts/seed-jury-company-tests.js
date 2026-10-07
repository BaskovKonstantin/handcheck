#!/usr/bin/env node
"use strict";

/**
 * Idempotent demo seed for jury accounts (employer vacancy tests + one submitted assignment).
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
const CANDIDATES = [
  { email: "jury-backend@demo.local", spec: "backend", cat: "backend_middle" },
  { email: "jury-frontend@demo.local", spec: "frontend", cat: "frontend_middle" },
  { email: "jury-qa@demo.local", spec: "qa", cat: "qa_middle" },
];

const TEMPLATE_BY_SPEC = {
  backend: "backend-api-basics",
  frontend: "backend-api-basics",
  qa: "qa-test-design",
};

function ensureUser(db, email, role) {
  let row = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (row) return row.id;
  const hash = bcrypt.hashSync(config.DEMO_PASSWORD, 10);
  const now = new Date().toISOString();
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, email_confirmed_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, email, hash, role, now);
  return id;
}

function seedJuryCompanyTests(db) {
  if (!config.DEMO_MODE) {
    console.error("Set DEMO_MODE=1");
    process.exit(1);
  }
  const employerId = ensureUser(db, JURY_EMPLOYER, "employer");
  const prof = db.prepare("SELECT 1 FROM employer_profiles WHERE user_id = ?").get(employerId);
  if (!prof) {
    db.prepare(
      `INSERT INTO employer_profiles (user_id, company_name, description, industry, contact_email)
       VALUES (?, 'Jury Demo Corp', 'FSP jury', 'IT', ?)`
    ).run(employerId, JURY_EMPLOYER);
  }

  const needs = {};
  for (const spec of ["backend", "frontend", "qa"]) {
    const title = `Jury need — ${spec}`;
    let need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? AND title = ?")
      .get(employerId, title);
    if (!need) {
      const id = newId();
      db.prepare(
        `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
         VALUES (?, ?, ?, ?, 'middle', '[]', '', '', 1)`
      ).run(id, employerId, title, spec);
      need = { id };
    }
    needs[spec] = need.id;

    let test = db
      .prepare(
        "SELECT id FROM employer_tests WHERE employer_user_id = ? AND need_id = ? AND status = 'published' LIMIT 1"
      )
      .get(employerId, need.id);
    if (!test) {
      const tplKey = TEMPLATE_BY_SPEC[spec];
      const tpl = getTemplate(tplKey);
      const testId = newId();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO employer_tests (id, employer_user_id, need_id, title, intro, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'published', ?, ?)`
      ).run(testId, employerId, need.id, tpl.title, tpl.intro, now, now);
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
      test = { id: testId };
    }
    needs[`${spec}Test`] = test.id;
  }

  for (const c of CANDIDATES) {
    const cid = ensureUser(db, c.email, "candidate");
    if (!db.prepare("SELECT 1 FROM candidate_profiles WHERE user_id = ?").get(cid)) {
      db.prepare(
        `INSERT INTO candidate_profiles (user_id, display_name, stack_json, phone, contact_email, consent_at, availability)
         VALUES (?, ?, '[]', '', ?, datetime('now'), 'open')`
      ).run(cid, c.email.split("@")[0], c.email);
    }
    if (!db.prepare("SELECT 1 FROM candidate_categories WHERE candidate_user_id = ?").get(cid)) {
      db.prepare(
        `INSERT INTO candidate_categories
         (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
         VALUES (?, ?, ?, 'middle', 0.7, 0.7, 0.65, 0.8, datetime('now'))`
      ).run(cid, c.cat, c.spec);
    }

    const testId = needs[`${c.spec}Test`];
    const existingAssign = db
      .prepare(
        "SELECT id FROM employer_test_assignments WHERE test_id = ? AND candidate_user_id = ? AND status = 'submitted' LIMIT 1"
      )
      .get(testId, cid);
    if (existingAssign) continue;

    const assignId = newId();
    const due = new Date();
    due.setDate(due.getDate() + 3);
    db.prepare(
      `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, invitation_id, status, due_at, started_at, submitted_at)
       VALUES (?, ?, ?, NULL, 'submitted', ?, datetime('now'), datetime('now'))`
    ).run(assignId, testId, cid, due.toISOString());

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

module.exports = { seedJuryCompanyTests, JURY_EMPLOYER };
