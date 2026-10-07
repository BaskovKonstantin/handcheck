"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { loadCandidatesForNeed, applyFilters } = require("../matching/pool");
const { employerCandidateView } = require("../../lib/privacy");
const { summarizeAiUsageForEmployer } = require("../../lib/ai-usage-summary");
const { getEmployerPasteInputMark } = require("../../lib/employer-paste-indicator");
const { listDeferredCandidates } = require("../../lib/employer-deferred-list");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

function getNeed(req, needId) {
  return getDb()
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, req.user.id);
}

router.get("/needs/:id/deck/next", (req, res, next) => {
  const need = getNeed(req, req.params.id);
  if (!need) return next(httpError(404, "not_found"));
  let items = loadCandidatesForNeed(need, req.user.id, { forDeck: true });
  items = applyFilters(items, req.query);
  if (!items.length) return res.json({ card: null });
  const c = items[0];
  const db = getDb();
  const aiUsage = summarizeAiUsageForEmployer(req.user.id, c.id);
  const pasteInputMark = getEmployerPasteInputMark(db, c.id);
  const card = employerCandidateView(req.user.id, {
    id: c.id,
    displayName: c.displayName,
    categoryLabel: c.categoryLabel,
    categoryStatus: c.categoryStatus,
    gradeRelation: c.gradeRelation,
    stack: c.stack,
    backgroundDomains: c.backgroundDomains,
    explanation: c.explanation.slice(0, 2),
    taskPhrases: c.taskPhrases,
    integrationNote: c.integrationNote,
    aiUsage,
    pasteInputMark,
    phone: c.phone,
    contact_email: c.contact_email,
  }, null);
  res.json({ card, candidateId: c.id });
});

router.post("/needs/:id/reviews", (req, res, next) => {
  const need = getNeed(req, req.params.id);
  if (!need) return next(httpError(404, "not_found"));
  const decision = req.body?.decision;
  const candidateId = req.body?.candidateId;
  const fields = {};
  if (!candidateId) fields.candidateId = "Укажите кандидата";
  if (!["rejected", "later"].includes(decision)) {
    fields.decision = "Решение должно быть «Отложить» или «Отказать»";
  }
  if (Object.keys(fields).length) return next(httpError(400, "invalid_body", { fields }));
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(employer_user_id, need_id, candidate_user_id)
       DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at`
    )
    .run(newId(), req.user.id, need.id, candidateId, decision, now);
  res.json({ ok: true });
});

router.delete("/needs/:id/reviews/:candidateId", (req, res, next) => {
  const need = getNeed(req, req.params.id);
  if (!need) return next(httpError(404, "not_found"));
  const row = getDb()
    .prepare(
      `SELECT * FROM need_reviews WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?`
    )
    .get(req.user.id, need.id, req.params.candidateId);
  if (!row || row.decision !== "later") return next(httpError(400, "not_later"));
  getDb()
    .prepare(
      "DELETE FROM need_reviews WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?"
    )
    .run(req.user.id, need.id, req.params.candidateId);
  res.json({ ok: true });
});

router.get("/needs/:id/deferred", (req, res, next) => {
  const need = getNeed(req, req.params.id);
  if (!need) return next(httpError(404, "not_found"));
  const db = getDb();
  res.json(listDeferredCandidates(db, need, req.user.id, req.query));
});

module.exports = router;
