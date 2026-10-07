"use strict";

/**
 * Idempotent jury demo enricher for jury@demo.local only.
 * Usage: node scripts/seed-jury-pack.js
 * Requires DEMO_MODE=1 and DB_PATH (or default /data/handcheck.sqlite on server).
 */

const path = require("path");
const bcrypt = require("bcryptjs");
const config = require("../app/config");
const { getDb } = require("../app/db");
const { newId } = require("../app/lib/ids");

const JURY_EMPLOYER = "jury@demo.local";
const MARKER_PREFIX = "jury-pack-";

function ensureJuryEmployer(db, hash, now) {
  let row = db.prepare("SELECT id FROM users WHERE email = ?").get(JURY_EMPLOYER);
  if (!row) {
    const id = newId();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_confirmed_at, created_at, is_test)
       VALUES (?, ?, ?, 'employer', ?, ?, 1)`
    ).run(id, JURY_EMPLOYER, hash, now, now);
    db.prepare(
      `INSERT INTO employer_profiles (user_id, company_name, description, industry, contact_email)
       VALUES (?, 'Жюри Демо', 'Пакет для обзора кабинета', 'IT', ?)`
    ).run(id, JURY_EMPLOYER);
    row = { id };
  }
  return row.id;
}

function ensureJuryCandidate(db, spec, hash, now) {
  let row = db.prepare("SELECT id FROM users WHERE email = ?").get(spec.email);
  if (!row) {
    const id = newId();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_confirmed_at, created_at, is_test)
       VALUES (?, ?, ?, 'candidate', ?, ?, 1)`
    ).run(id, spec.email, hash, now, now);
    db.prepare(
      `INSERT INTO candidate_profiles (user_id, display_name, stack_json, phone, contact_email, availability)
       VALUES (?, ?, ?, '+79009990000', ?, 'open')`
    ).run(id, spec.name, JSON.stringify(spec.stack), spec.email);
    db.prepare(
      `INSERT INTO candidate_private (candidate_user_id, integrity, trust_ok) VALUES (?, 0.9, 1)`
    ).run(id);
    const cat = db
      .prepare("SELECT id FROM categories WHERE specialization = ? AND grade = ?")
      .get(spec.spec, spec.grade);
    if (cat) {
      db.prepare(
        `INSERT OR REPLACE INTO candidate_categories
         (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
         VALUES (?, ?, ?, ?, 0.82, 0.8, 0.75, 0.7, ?)`
      ).run(id, cat.id, spec.spec, spec.grade, now);
    }
    row = { id };
  }
  return row.id;
}

function seedJuryPack() {
  if (!config.DEMO_MODE) {
    console.error("DEMO_MODE must be enabled");
    process.exit(1);
  }
  const db = getDb();
  const existing = db
    .prepare("SELECT 1 FROM invitations WHERE id LIKE ? LIMIT 1")
    .get(`${MARKER_PREFIX}%`);
  if (existing) {
    console.log("jury pack already applied");
    return { skipped: true };
  }

  const hash = bcrypt.hashSync(config.DEMO_PASSWORD, 10);
  const now = new Date().toISOString();
  const employerId = ensureJuryEmployer(db, hash, now);

  let need = db
    .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1")
    .get(employerId);
  if (!need) {
    const needId = `${MARKER_PREFIX}need`;
    db.prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
       VALUES (?, ?, 'Жюри · Backend Middle', 'backend', 'middle', ?, 'автоматизация ресторана', '', 1)`
    ).run(needId, employerId, JSON.stringify(["node", "typescript"]));
    need = { id: needId };
  }

  const candidates = [
    { email: "jury-anna@demo.local", name: "Жюри Анна", spec: "backend", grade: "middle", stack: ["node"] },
    { email: "jury-boris@demo.local", name: "Жюри Борис", spec: "backend", grade: "senior", stack: ["node", "go"] },
    { email: "jury-clara@demo.local", name: "Жюри Клара", spec: "backend", grade: "junior", stack: ["node"] },
    { email: "jury-denis@demo.local", name: "Жюри Денис", spec: "backend", grade: "middle", stack: ["node", "postgres"] },
  ].map((c) => ({ ...c, id: ensureJuryCandidate(db, c, hash, now) }));

  const inviteSpecs = [
    { id: `${MARKER_PREFIX}inv-sent`, status: "sent", candidate: candidates[0] },
    { id: `${MARKER_PREFIX}inv-viewed`, status: "viewed", candidate: candidates[1] },
    { id: `${MARKER_PREFIX}inv-accepted`, status: "accepted", candidate: candidates[2] },
    { id: `${MARKER_PREFIX}inv-declined`, status: "declined", candidate: candidates[3] },
  ];

  for (const inv of inviteSpecs) {
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status, created_at)
       VALUES (?, ?, ?, ?, 200000, 280000, 'Жюри-пакет: приглашение для демо обзора', 'email', ?, datetime('now', '-2 days'))`
    ).run(inv.id, employerId, need.id, inv.candidate.id, inv.status);
  }

  db.prepare(
    `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at)
     VALUES (?, ?, ?, ?, 'later', datetime('now'))`
  ).run(`${MARKER_PREFIX}rev-later`, employerId, need.id, candidates[0].id);

  db.prepare(
    `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at)
     VALUES (?, ?, ?, ?, 'rejected', datetime('now'))`
  ).run(`${MARKER_PREFIX}rev-rejected`, employerId, need.id, candidates[3].id);

  const acceptedId = `${MARKER_PREFIX}inv-accepted`;
  const callId = `${MARKER_PREFIX}call`;
  db.prepare(
    `INSERT INTO calls (id, invitation_id, status, started_at, ended_at, transcript_text, consent_at_candidate, consent_at_employer)
     VALUES (?, ?, 'ended', datetime('now', '-1 days'), datetime('now', '-1 days'), 'Кандидат описал опыт с Node и REST.', datetime('now'), datetime('now'))`
  ).run(callId, acceptedId);
  db.prepare(
    `INSERT INTO call_analyses (call_id, summary_text, domain_hits_json, consistency_note)
     VALUES (?, 'Кандидат уверенно описал backend-задачи. Совпадение с доменом ресторана умеренное. Рекомендуем приглашение на финал.', '[]', '')`
  ).run(callId);

  console.log("jury pack applied for", JURY_EMPLOYER);
  return { skipped: false };
}

if (require.main === module) {
  seedJuryPack();
}

module.exports = { seedJuryPack };
