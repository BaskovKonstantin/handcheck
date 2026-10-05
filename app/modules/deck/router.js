"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { loadCandidatesForNeed, applyFilters } = require("../matching/pool");
const { employerCandidateView } = require("../../lib/privacy");

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
  let items = loadCandidatesForNeed(need, req.user.id);
  items = applyFilters(items, req.query);
  if (!items.length) return res.json({ card: null });
  const c = items[0];
  const card = employerCandidateView(req.user.id, {
    id: c.id,
    displayName: c.displayName,
    categoryLabel: c.categoryLabel,
    stack: c.stack,
    backgroundDomains: c.backgroundDomains,
    explanation: c.explanation.slice(0, 2),
    taskPhrases: c.taskPhrases,
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
  if (!["rejected", "later"].includes(decision) || !candidateId) {
    return next(httpError(400, "invalid_body"));
  }
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
  const rows = getDb()
    .prepare(
      `SELECT nr.candidate_user_id, cp.display_name, c.label
       FROM need_reviews nr
       JOIN candidate_profiles cp ON cp.user_id = nr.candidate_user_id
       JOIN candidate_categories cc ON cc.candidate_user_id = nr.candidate_user_id
       JOIN categories c ON c.id = cc.category_id
       WHERE nr.need_id = ? AND nr.employer_user_id = ? AND nr.decision = 'later'`
    )
    .all(need.id, req.user.id);
  res.json({
    items: rows.map((r) => ({
      candidateId: r.candidate_user_id,
      displayName: r.display_name,
      categoryLabel: r.label,
    })),
  });
});

module.exports = router;
