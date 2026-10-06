"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

router.get("/profile", (req, res) => {
  const p = getDb()
    .prepare("SELECT * FROM employer_profiles WHERE user_id = ?")
    .get(req.user.id);
  res.json({
    companyName: p.company_name,
    description: p.description,
    industry: p.industry,
    contactEmail: p.contact_email,
  });
});

router.put("/profile", (req, res) => {
  const { companyName = "", description = "", industry = "", contactEmail = "" } = req.body || {};
  getDb()
    .prepare(
      `UPDATE employer_profiles SET company_name = ?, description = ?, industry = ?, contact_email = ?
       WHERE user_id = ?`
    )
    .run(companyName, description, industry, contactEmail, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
