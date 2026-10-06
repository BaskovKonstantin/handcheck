"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { validateOptionalEmail } = require("../../lib/validation");
const { shouldMarkUserAsTest } = require("../../lib/is-test-user");

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
    const fields = {};
    let companyName = existing.company_name;
    if (body.companyName !== undefined) {
      companyName = String(body.companyName).trim();
      if (!companyName) fields.companyName = "Укажите название компании";
      else if (companyName.length > 120) fields.companyName = "Название компании — не длиннее 120 символов";
    }
    const description = body.description !== undefined ? String(body.description) : existing.description;
    const industry = body.industry !== undefined ? String(body.industry) : existing.industry;
    let contactEmail = existing.contact_email || "";
    if (body.contactEmail !== undefined) {
      const v = validateOptionalEmail(body.contactEmail);
      Object.assign(fields, v.fields);
      if (!v.fields.contactEmail) contactEmail = v.value;
    }
    if (Object.keys(fields).length) throw httpError(400, "invalid_body", { fields });
    db.prepare(
      `UPDATE employer_profiles SET company_name = ?, description = ?, industry = ?, contact_email = ?
       WHERE user_id = ?`
    ).run(companyName, description, industry, contactEmail, req.user.id);
    const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
    const isTest = shouldMarkUserAsTest(user.email, companyName) ? 1 : 0;
    db.prepare("UPDATE users SET is_test = ? WHERE id = ?").run(isTest, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
