"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { validateOptionalEmail } = require("../../lib/validation");

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

router.put("/profile", (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM employer_profiles WHERE user_id = ?").get(req.user.id);
    const body = req.body || {};
    const companyName = body.companyName !== undefined ? String(body.companyName) : existing.company_name;
    const description = body.description !== undefined ? String(body.description) : existing.description;
    const industry = body.industry !== undefined ? String(body.industry) : existing.industry;
    let contactEmail = existing.contact_email || "";
    if (body.contactEmail !== undefined) {
      const v = validateOptionalEmail(body.contactEmail);
      if (v.fields.contactEmail) throw httpError(400, "invalid_body", { fields: v.fields });
      contactEmail = v.value;
    }
    db.prepare(
      `UPDATE employer_profiles SET company_name = ?, description = ?, industry = ?, contact_email = ?
       WHERE user_id = ?`
    ).run(companyName, description, industry, contactEmail, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
