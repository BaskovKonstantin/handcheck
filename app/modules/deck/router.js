"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { getNextDeckCard, recordNeedReview } = require("./actions");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

function getNeed(req, needId) {
  return getDb()
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, req.user.id);
}

router.get("/needs/:id/deck/next", (req, res, next) => {
  try {
    const result = getNextDeckCard(req.user.id, req.params.id, req.query);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/needs/:id/reviews", (req, res, next) => {
  try {
    const decision = req.body?.decision;
    const candidateId = req.body?.candidateId;
    if (!["rejected", "later"].includes(decision) || !candidateId) {
      return next(httpError(400, "invalid_body"));
    }
    recordNeedReview(req.user.id, req.params.id, candidateId, decision, "web");
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
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
