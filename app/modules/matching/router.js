"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { loadCandidatesForNeed, applyFilters, publicMatchShape } = require("./pool");

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
  res.json({ items: items.map(publicMatchShape) });
});

module.exports = router;
