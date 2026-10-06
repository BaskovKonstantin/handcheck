"use strict";

const express = require("express");
const { getDb } = require("../../db");

const router = express.Router();

router.get("/", (_req, res) => {
  const db = getDb();
  const categories = db
    .prepare(
      `SELECT COUNT(*) AS c FROM candidate_categories cc
       JOIN users u ON u.id = cc.candidate_user_id WHERE u.is_test = 0`
    )
    .get().c;
  const openCandidates = db
    .prepare(
      `SELECT COUNT(*) AS c FROM candidate_profiles cp
       JOIN candidate_categories cc ON cc.candidate_user_id = cp.user_id
       JOIN users u ON u.id = cp.user_id
       WHERE cp.availability = 'open' AND u.is_test = 0`
    )
    .get().c;
  const invitations = db
    .prepare(
      `SELECT COUNT(*) AS c FROM invitations i
       JOIN users uc ON uc.id = i.candidate_user_id
       JOIN users ue ON ue.id = i.employer_user_id
       WHERE uc.is_test = 0 AND ue.is_test = 0`
    )
    .get().c;
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
