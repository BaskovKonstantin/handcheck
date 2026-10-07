"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { loadCandidatesForNeed, applyFilters, publicMatchShape } = require("./pool");
const { summarizeAiUsageForEmployer } = require("../../lib/ai-usage-summary");
const { getEmployerPasteInputMark } = require("../../lib/employer-paste-indicator");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

router.get("/needs/:id/matches", (req, res, next) => {
  const db = getDb();
  const need = db
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(req.params.id, req.user.id);
  if (!need) return next(httpError(404, "not_found"));
  let items = loadCandidatesForNeed(need, req.user.id);
  items = applyFilters(items, req.query);
  res.json({
    items: items.map((c) => {
      const row = publicMatchShape(c);
      row.aiUsage = summarizeAiUsageForEmployer(req.user.id, c.id);
      const pasteInputMark = getEmployerPasteInputMark(db, c.id);
      if (pasteInputMark) row.pasteInputMark = pasteInputMark;
      return row;
    }),
  });
});

module.exports = router;
