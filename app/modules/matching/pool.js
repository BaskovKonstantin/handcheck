"use strict";

const { getDb } = require("../../db");
const { rankCandidates } = require("../../lib/ranking");
const { buildTaskPhrases } = require("../../lib/task-phrases");
const { buildExplanation } = require("./explain");
const { buildIntegrationNoteForBattery } = require("../../lib/ai-usage-summary");
const { stackMatchesFilter } = require("../../lib/stack-normalize");
const { publicCandidateDisplayName } = require("../../lib/public-candidate-name");

function loadCandidatesForNeed(need, employerUserId, options = {}) {
  const forDeck = options.forDeck === true;
  const db = getDb();
  const employerIsTest = Boolean(
    db.prepare("SELECT is_test FROM users WHERE id = ?").get(employerUserId)?.is_test
  );
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.is_test, cp.display_name, cp.stack_json, cp.phone, cp.contact_email, cp.availability,
              cc.test_score, cc.motivation, cc.assigned_at, c.label AS category_label,
              priv.trust_ok
       FROM candidate_categories cc
       JOIN users u ON u.id = cc.candidate_user_id
       JOIN candidate_profiles cp ON cp.user_id = u.id
       JOIN categories c ON c.id = cc.category_id
       JOIN candidate_private priv ON priv.candidate_user_id = u.id
       WHERE cc.specialization = ? AND cc.grade = ?
         AND cp.availability = 'open' AND priv.trust_ok = 1`
    )
    .all(need.specialization, need.grade);

  const out = [];
  for (const r of rows) {
    if (!employerIsTest && r.is_test) continue;
    const rejected = db
      .prepare(
        `SELECT decision FROM need_reviews WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?`
      )
      .get(employerUserId, need.id, r.user_id);
    let decision = rejected?.decision;
    const lastInv = db
      .prepare(
        `SELECT status FROM invitations
         WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(employerUserId, need.id, r.user_id);
    if (lastInv?.status === "declined") decision = "declined";
    if (decision === "rejected") continue;
    if (decision === "later") continue;
    if (forDeck && decision === "invited") continue;

    const episodes = db
      .prepare(
        "SELECT role_title, domain, industry FROM background_episodes WHERE candidate_user_id = ?"
      )
      .all(r.user_id);
    const fsp = db
      .prepare("SELECT COUNT(*) AS c FROM fsp_achievements WHERE candidate_user_id = ?")
      .get(r.user_id).c;

    const lastBattery = db
      .prepare(
        `SELECT id FROM batteries WHERE candidate_user_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(r.user_id);
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

    out.push({
      id: r.user_id,
      reviewDecision: decision || null,
      displayName: publicCandidateDisplayName(r.display_name),
      categoryLabel: r.category_label,
      stack: JSON.parse(r.stack_json || "[]"),
      phone: r.phone,
      contact_email: r.contact_email,
      episodes,
      hasFsp: fsp > 0,
      test_score: r.test_score,
      motivation: r.motivation,
      assigned_at: r.assigned_at,
      taskPhrases,
      integrationNote,
      backgroundDomains: episodes.map((e) => `${e.role_title} · ${e.industry}`).filter(Boolean),
    });
  }

  const ranked = rankCandidates(out, need);
  return ranked.map((c) => {
    const explanation = buildExplanation(c, need);
    return {
      id: c.id,
      categoryLabel: c.categoryLabel,
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
