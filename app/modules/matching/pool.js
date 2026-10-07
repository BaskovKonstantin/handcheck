"use strict";

const { getDb } = require("../../db");
const { rankCandidates } = require("../../lib/ranking");
const { buildTaskPhrases } = require("../../lib/task-phrases");
const { buildExplanation } = require("./explain");
const { buildIntegrationNoteForBattery } = require("../../lib/ai-usage-summary");
const { stackMatchesFilter } = require("../../lib/stack-normalize");
const { publicCandidateDisplayName } = require("../../lib/public-candidate-name");
const {
  CATEGORY_STATUS_CONFIRMED,
  CATEGORY_STATUS_UNCONFIRMED,
  unconfirmedLabelForNeed,
} = require("../../lib/category-status");
const { gradeRelationForNeed } = require("../../lib/grade-match");
const { isEligibleForEmployerPool } = require("../../lib/employer-pool-eligibility");

const UNCONFIRMED_TEST_SCORE = 0.38;
const UNCONFIRMED_MOTIVATION = 0.42;

function loadEpisodesAndPhrases(db, userId) {
  const episodes = db
    .prepare(
      "SELECT role_title, domain, industry FROM background_episodes WHERE candidate_user_id = ?"
    )
    .all(userId);
  const lastBattery = db
    .prepare(
      `SELECT id FROM batteries WHERE candidate_user_id = ? ORDER BY started_at DESC LIMIT 1`
    )
    .get(userId);
  let taskPhrases = [
    "Короткие ответы по API сданы",
    "Рабочая задача доведена до конца",
    "По ходу задачи были промежуточные черновики",
  ];
  if (lastBattery) {
    const attempts = db
      .prepare(
        `SELECT a.submitted_at, t.type FROM attempts a JOIN tasks t ON t.id = a.task_id WHERE a.battery_id = ?`
      )
      .all(lastBattery.id);
    const quickSubmitted = attempts.filter((a) => a.type === "quick" && a.submitted_at).length;
    const work = attempts.find((a) => a.type === "work");
    const hadDraft = db
      .prepare(
        `SELECT COUNT(*) AS c FROM attempt_events e JOIN attempts a ON a.id = e.attempt_id
         WHERE a.battery_id = ? AND e.event_type = 'draft'`
      )
      .get(lastBattery.id).c;
    taskPhrases = buildTaskPhrases({
      quickSubmittedCount: quickSubmitted,
      workSubmittedOnTime: Boolean(work?.submitted_at),
      hadDraft: hadDraft > 0,
    });
  }
  const integrationNote = lastBattery
    ? buildIntegrationNoteForBattery(db, lastBattery.id)
    : null;
  return { episodes, taskPhrases, integrationNote, lastBattery };
}

function reviewDecisionFor(db, employerUserId, needId, userId) {
  const rejected = db
    .prepare(
      `SELECT decision FROM need_reviews WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?`
    )
    .get(employerUserId, needId, userId);
  let decision = rejected?.decision;
  const lastInv = db
    .prepare(
      `SELECT status FROM invitations
       WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(employerUserId, needId, userId);
  if (lastInv?.status === "declined") decision = "declined";
  return decision || null;
}

function shouldSkipForDeck(decision, forDeck) {
  if (decision === "rejected") return true;
  if (decision === "later") return true;
  if (forDeck && decision === "invited") return true;
  return false;
}

function pushCandidateRow(out, ctx) {
  const {
    db,
    need,
    employerUserId,
    forDeck,
    row,
    categoryLabel,
    categoryStatus,
    confirmedGrade,
    test_score,
    motivation,
    assigned_at,
  } = ctx;
  const decision = reviewDecisionFor(db, employerUserId, need.id, row.user_id);
  if (shouldSkipForDeck(decision, forDeck)) return;

  const { episodes, taskPhrases, integrationNote } = loadEpisodesAndPhrases(db, row.user_id);
  const fsp = db
    .prepare("SELECT COUNT(*) AS c FROM fsp_achievements WHERE candidate_user_id = ?")
    .get(row.user_id).c;

  const gradeRelation = gradeRelationForNeed(confirmedGrade, need.grade, categoryStatus);
  out.push({
    id: row.user_id,
    reviewDecision: decision,
    displayName: publicCandidateDisplayName(row.display_name, row.email),
    categoryLabel,
    categoryStatus,
    confirmedGrade: confirmedGrade || null,
    gradeRelation,
    stack: JSON.parse(row.stack_json || "[]"),
    phone: row.phone,
    contact_email: row.contact_email,
    episodes,
    hasFsp: fsp > 0,
    test_score,
    motivation,
    assigned_at,
    taskPhrases,
    integrationNote,
    backgroundDomains: episodes.map((e) => `${e.role_title} · ${e.industry}`).filter(Boolean),
  });
}

function loadCandidatesForNeed(need, employerUserId, options = {}) {
  const forDeck = options.forDeck === true;
  const db = getDb();
  const employerIsTest = Boolean(
    db.prepare("SELECT is_test FROM users WHERE id = ?").get(employerUserId)?.is_test
  );
  const confirmedSelect = `SELECT u.id AS user_id, u.email, u.email_confirmed_at, u.is_test, cp.display_name, cp.stack_json, cp.phone, cp.contact_email, cp.availability,
              cc.test_score, cc.motivation, cc.assigned_at, cc.grade AS confirmed_grade, c.label AS category_label,
              priv.trust_ok`;

  const confirmedRows = db
    .prepare(
      `${confirmedSelect}
       FROM candidate_categories cc
       JOIN users u ON u.id = cc.candidate_user_id
       JOIN candidate_profiles cp ON cp.user_id = u.id
       JOIN categories c ON c.id = cc.category_id
       JOIN candidate_private priv ON priv.candidate_user_id = u.id
       WHERE cc.specialization = ? AND cc.grade = ?
         AND cp.availability = 'open' AND priv.trust_ok = 1
         AND u.email_confirmed_at IS NOT NULL`
    )
    .all(need.specialization, need.grade);

  const offGradeRows = db
    .prepare(
      `${confirmedSelect}
       FROM candidate_categories cc
       JOIN users u ON u.id = cc.candidate_user_id
       JOIN candidate_profiles cp ON cp.user_id = u.id
       JOIN categories c ON c.id = cc.category_id
       JOIN candidate_private priv ON priv.candidate_user_id = u.id
       WHERE cc.specialization = ? AND cc.grade <> ?
         AND cp.availability = 'open' AND priv.trust_ok = 1
         AND u.email_confirmed_at IS NOT NULL`
    )
    .all(need.specialization, need.grade);

  const unconfirmedRows = db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.email_confirmed_at, u.is_test, cp.display_name, cp.stack_json, cp.phone, cp.contact_email,
              u.created_at AS assigned_at, priv.trust_ok
       FROM users u
       JOIN candidate_profiles cp ON cp.user_id = u.id
       JOIN candidate_private priv ON priv.candidate_user_id = u.id
       LEFT JOIN candidate_categories cc_match ON cc_match.candidate_user_id = u.id
         AND cc_match.specialization = ? AND cc_match.grade = ?
       WHERE u.role = 'candidate'
         AND cp.availability = 'open'
         AND priv.trust_ok = 1
         AND u.email_confirmed_at IS NOT NULL
         AND cc_match.candidate_user_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM candidate_categories cc_other
           WHERE cc_other.candidate_user_id = u.id
             AND cc_other.specialization <> ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM candidate_categories cc_same_spec
           WHERE cc_same_spec.candidate_user_id = u.id
             AND cc_same_spec.specialization = ?
         )`
    )
    .all(need.specialization, need.grade, need.specialization, need.specialization);

  const out = [];
  const seen = new Set();

  for (const r of confirmedRows) {
    if (!employerIsTest && r.is_test) continue;
    if (!isEligibleForEmployerPool(r)) continue;
    seen.add(r.user_id);
    pushCandidateRow(out, {
      db,
      need,
      employerUserId,
      forDeck,
      row: r,
      categoryLabel: r.category_label,
      categoryStatus: CATEGORY_STATUS_CONFIRMED,
      confirmedGrade: r.confirmed_grade,
      test_score: r.test_score,
      motivation: r.motivation,
      assigned_at: r.assigned_at,
    });
  }

  for (const r of offGradeRows) {
    if (!employerIsTest && r.is_test) continue;
    if (!isEligibleForEmployerPool(r)) continue;
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    pushCandidateRow(out, {
      db,
      need,
      employerUserId,
      forDeck,
      row: r,
      categoryLabel: r.category_label,
      categoryStatus: CATEGORY_STATUS_CONFIRMED,
      confirmedGrade: r.confirmed_grade,
      test_score: r.test_score,
      motivation: r.motivation,
      assigned_at: r.assigned_at,
    });
  }

  for (const r of unconfirmedRows) {
    if (!employerIsTest && r.is_test) continue;
    if (!isEligibleForEmployerPool(r)) continue;
    if (seen.has(r.user_id)) continue;
    pushCandidateRow(out, {
      db,
      need,
      employerUserId,
      forDeck,
      row: r,
      categoryLabel: unconfirmedLabelForNeed(need),
      categoryStatus: CATEGORY_STATUS_UNCONFIRMED,
      confirmedGrade: null,
      test_score: UNCONFIRMED_TEST_SCORE,
      motivation: UNCONFIRMED_MOTIVATION,
      assigned_at: r.assigned_at,
    });
  }

  const ranked = rankCandidates(out, need);
  return ranked.map((c) => {
    const explanation = buildExplanation(c, need);
    return {
      id: c.id,
      categoryLabel: c.categoryLabel,
      categoryStatus: c.categoryStatus,
      gradeRelation: c.gradeRelation,
      stack: c.stack,
      backgroundDomains: c.backgroundDomains,
      explanation,
      taskPhrases: c.taskPhrases,
      integrationNote: c.integrationNote,
      _rank: c.rank,
      domain_boost: c.domain_boost,
      fsp_boost: c.fsp_boost,
      displayName: c.displayName,
      reviewDecision: c.reviewDecision,
      phone: c.phone,
      contact_email: c.contact_email,
    };
  });
}

function applyFilters(items, query) {
  let list = items;
  if (query.stack) {
    list = list.filter((c) => stackMatchesFilter(c.stack, query.stack));
  }
  if (query.fsp === "1") list = list.filter((c) => c.fsp_boost === 1);
  if (query.fsp === "0") list = list.filter((c) => c.fsp_boost === 0);
  return list;
}

function publicMatchShape(c) {
  const row = {
    id: c.id,
    displayName: c.displayName,
    categoryLabel: c.categoryLabel,
    categoryStatus: c.categoryStatus,
    gradeRelation: c.gradeRelation,
    stack: c.stack,
    backgroundDomains: c.backgroundDomains,
    explanation: c.explanation,
    taskPhrases: c.taskPhrases,
    integrationNote: c.integrationNote,
  };
  if (c.reviewDecision === "invited") row.reviewStatus = "invited";
  else if (c.reviewDecision === "declined") row.reviewStatus = "declined";
  else if (c.reviewDecision === "later") row.reviewStatus = "later";
  else if (c.reviewDecision === "rejected") row.reviewStatus = "rejected";
  return row;
}

module.exports = { loadCandidatesForNeed, applyFilters, publicMatchShape };
