"use strict";

const express = require("express");
const { getDb } = require("../../db");

const router = express.Router();

router.get("/", (_req, res) => {
  const db = getDb();
  const categories = db.prepare("SELECT COUNT(*) AS c FROM candidate_categories").get().c;
  const openCandidates = db
    .prepare(
      `SELECT COUNT(*) AS c FROM candidate_profiles cp
       JOIN candidate_categories cc ON cc.candidate_user_id = cp.user_id
       WHERE cp.availability = 'open'`
    )
    .get().c;
  const invitations = db.prepare("SELECT COUNT(*) AS c FROM invitations").get().c;
  res.json({
    categories: categories || 9,
    categoriesDemo: categories === 0,
    openCandidates: openCandidates || 2,
    openCandidatesDemo: openCandidates === 0,
    invitations: invitations || 0,
    invitationsDemo: invitations === 0,
  });
});

module.exports = router;
