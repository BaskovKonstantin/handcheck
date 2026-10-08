"use strict";

const { getDb } = require("../../db");
const { publicCandidateDisplayName } = require("../../lib/public-candidate-name");
const { isEligibleForEmployerPool } = require("../../lib/employer-pool-eligibility");
const {
  CATEGORY_STATUS_CONFIRMED,
  CATEGORY_STATUS_UNCONFIRMED,
  unconfirmedLabelForNeed,
} = require("../../lib/category-status");
const { loadEpisodesAndPhrases, reviewDecisionFor } = require("./pool");

const UNCONFIRMED_TEST_SCORE = 0.38;
const UNCONFIRMED_MOTIVATION = 0.42;

function loadOpenBank(employerUserId, options = {}) {
  const needForUnconfirmed = options.needForUnconfirmed || null;
  const db = getDb();
  const employerIsTest = Boolean(
    db.prepare("SELECT is_test FROM users WHERE id = ?").get(employerUserId)?.is_test
  );

  const confirmedSelect = `SELECT u.id AS user_id, u.email, u.email_confirmed_at, u.is_test, cp.display_name, cp.stack_json, cp.phone, cp.contact_email,
              cc.test_score, cc.motivation, cc.assigned_at, cc.grade AS confirmed_grade, cc.specialization,
              c.label AS category_label, priv.trust_ok`;

  const confirmedRows = db
    .prepare(
      `${confirmedSelect}
       FROM candidate_categories cc
       JOIN users u ON u.id = cc.candidate_user_id
       JOIN candidate_profiles cp ON cp.user_id = u.id
       JOIN categories c ON c.id = cc.category_id
       JOIN candidate_private priv ON priv.candidate_user_id = u.id
       WHERE cp.availability = 'open' AND priv.trust_ok = 1
         AND u.email_confirmed_at IS NOT NULL`
    )
    .all();

  const unconfirmedRows = db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.email_confirmed_at, u.is_test, cp.display_name, cp.stack_json, cp.phone, cp.contact_email,
              u.created_at AS assigned_at, priv.trust_ok
       FROM users u
       JOIN candidate_profiles cp ON cp.user_id = u.id
       JOIN candidate_private priv ON priv.candidate_user_id = u.id
       LEFT JOIN candidate_categories cc ON cc.candidate_user_id = u.id
       WHERE u.role = 'candidate'
         AND cp.availability = 'open'
         AND priv.trust_ok = 1
         AND u.email_confirmed_at IS NOT NULL
         AND cc.candidate_user_id IS NULL`
    )
    .all();

  const out = [];
  const seen = new Set();

  for (const r of confirmedRows) {
    if (!employerIsTest && r.is_test) continue;
    if (!isEligibleForEmployerPool(r)) continue;
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    pushOpenRow(out, db, employerUserId, r, {
      categoryLabel: r.category_label,
      categoryStatus: CATEGORY_STATUS_CONFIRMED,
      confirmedGrade: r.confirmed_grade,
      specialization: r.specialization,
      test_score: r.test_score,
      motivation: r.motivation,
      assigned_at: r.assigned_at,
      needId: options.needId || null,
    });
  }

  const unconfirmedLabel = needForUnconfirmed
    ? unconfirmedLabelForNeed(needForUnconfirmed)
    : "Категория не подтверждена";

  for (const r of unconfirmedRows) {
    if (!employerIsTest && r.is_test) continue;
    if (!isEligibleForEmployerPool(r)) continue;
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    pushOpenRow(out, db, employerUserId, r, {
      categoryLabel: unconfirmedLabel,
      categoryStatus: CATEGORY_STATUS_UNCONFIRMED,
      confirmedGrade: null,
      specialization: null,
      test_score: UNCONFIRMED_TEST_SCORE,
      motivation: UNCONFIRMED_MOTIVATION,
      assigned_at: r.assigned_at,
      needId: options.needId || null,
    });
  }

  return out;
}

function pushOpenRow(out, db, employerUserId, row, meta) {
  const { episodes, taskPhrases, integrationNote } = loadEpisodesAndPhrases(db, row.user_id);
  const fsp = db
    .prepare("SELECT COUNT(*) AS c FROM fsp_achievements WHERE candidate_user_id = ?")
    .get(row.user_id).c;
  const reviewDecision = meta.needId
    ? reviewDecisionFor(db, employerUserId, meta.needId, row.user_id)
    : null;

  out.push({
    id: row.user_id,
    reviewDecision,
    displayName: publicCandidateDisplayName(row.display_name, row.email),
    categoryLabel: meta.categoryLabel,
    categoryStatus: meta.categoryStatus,
    confirmedGrade: meta.confirmedGrade,
    gradeRelation: "exact",
    specialization: meta.specialization,
    grade: meta.confirmedGrade,
    stack: JSON.parse(row.stack_json || "[]"),
    phone: row.phone,
    contact_email: row.contact_email,
    episodes,
    hasFsp: fsp > 0,
    test_score: meta.test_score,
    motivation: meta.motivation,
    assigned_at: meta.assigned_at,
    taskPhrases,
    integrationNote,
    backgroundDomains: episodes.map((e) => `${e.role_title} · ${e.industry}`).filter(Boolean),
  });
}

module.exports = { loadOpenBank };
