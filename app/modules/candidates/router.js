"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const {
  validateDisplayName,
  validateOptionalEmail,
  validateOptionalPhone,
  validateBackgroundEpisode,
} = require("../../lib/validation");
const { shouldMarkUserAsTest } = require("../../lib/is-test-user");
const { normalizeStackInput } = require("../../lib/need-validation");
const { dbDateToIso } = require("../../lib/db-datetime");
const { sanitizeStoredDisplayName } = require("../../lib/public-candidate-name");
const { formatSpecGradeLabel } = require("../../lib/category-labels");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("candidate"));

router.get("/profile", (req, res) => {
  const db = getDb();
  const p = db
    .prepare("SELECT * FROM candidate_profiles WHERE user_id = ?")
    .get(req.user.id);
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
  res.json({
    displayName: sanitizeStoredDisplayName(p.display_name, user?.email),
    stack: JSON.parse(p.stack_json || "[]"),
    phone: p.phone,
    contactEmail: p.contact_email,
    availability: p.availability,
  });
});

router.put("/profile", (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(req.user.id);
    const fields = {};
    let displayName = existing.display_name;
    if (req.body?.displayName !== undefined) {
      const v = validateDisplayName(req.body.displayName);
      Object.assign(fields, v.fields);
      if (!v.fields.displayName) displayName = v.displayName;
    }
    let stack = Array.isArray(req.body?.stack) ? req.body.stack : JSON.parse(existing.stack_json || "[]");
    if (req.body?.stack !== undefined) {
      const stackNorm = normalizeStackInput(req.body.stack);
      Object.assign(fields, stackNorm.fields);
      if (!stackNorm.fields.stack) stack = stackNorm.stack || [];
    }
    let phone = existing.phone || "";
    if (req.body?.phone !== undefined) {
      const v = validateOptionalPhone(req.body.phone);
      Object.assign(fields, v.fields);
      if (!v.fields.phone) phone = v.phone;
    }
    let contactEmail = existing.contact_email || "";
    if (req.body?.contactEmail !== undefined) {
      const v = validateOptionalEmail(req.body.contactEmail);
      Object.assign(fields, v.fields);
      if (!v.fields.contactEmail) contactEmail = v.value;
    }
    if (Object.keys(fields).length) throw httpError(400, "invalid_body", { fields });
    db.prepare(
      `UPDATE candidate_profiles SET display_name = ?, stack_json = ?, phone = ?, contact_email = ?
       WHERE user_id = ?`
    ).run(displayName, JSON.stringify(stack), phone, contactEmail, req.user.id);
    const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
    const isTest = shouldMarkUserAsTest(user.email, displayName) ? 1 : 0;
    db.prepare("UPDATE users SET is_test = ? WHERE id = ?").run(isTest, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/background", (req, res) => {
  const rows = getDb()
    .prepare(
      "SELECT id, role_title, domain, industry, note FROM background_episodes WHERE candidate_user_id = ?"
    )
    .all(req.user.id);
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      roleTitle: r.role_title,
      domain: r.domain,
      industry: r.industry,
      note: r.note,
    })),
  });
});

router.post("/background", (req, res, next) => {
  try {
  const id = newId();
  const { roleTitle, domain, industry, note } = validateBackgroundEpisode(req.body || {});
  getDb()
    .prepare(
      `INSERT INTO background_episodes (id, candidate_user_id, role_title, domain, industry, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, req.user.id, roleTitle, domain, industry, note);
  res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

router.delete("/background/:id", (req, res) => {
  getDb()
    .prepare("DELETE FROM background_episodes WHERE id = ? AND candidate_user_id = ?")
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.put("/availability", (req, res, next) => {
  const v = req.body?.availability;
  if (!["open", "paused"].includes(v)) {
    return next(
      httpError(400, "invalid_availability", {
        fields: { availability: "Выберите «Открыт к приглашениям» или «Пауза»" },
      })
    );
  }
  getDb()
    .prepare("UPDATE candidate_profiles SET availability = ? WHERE user_id = ?")
    .run(v, req.user.id);
  res.json({ ok: true });
});

router.get("/category", (req, res) => {
  const db = getDb();
  const appConfig = require("../../config");
  const cat = db
    .prepare(
      `SELECT cc.*, c.label FROM candidate_categories cc
       JOIN categories c ON c.id = cc.category_id WHERE cc.candidate_user_id = ?`
    )
    .get(req.user.id);
  const lastBattery = db
    .prepare(
      `SELECT specialization, completed_at FROM batteries
       WHERE candidate_user_id = ? AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`
    )
    .get(req.user.id);
  let retakeAt = null;
  let onCooldown = false;
  const bumpRetake = (completedAt) => {
    if (!completedAt) return;
    const d = new Date(completedAt);
    d.setDate(d.getDate() + Number(appConfig.GRADE_COOLDOWN_DAYS || 90));
    retakeAt = d.toISOString();
    onCooldown = new Date() < d;
  };
  if (!cat) {
    bumpRetake(lastBattery?.completed_at);
    return res.json({
      label: null,
      retakeAt: onCooldown ? retakeAt : null,
      cooldownActive: onCooldown,
      lastSpecialization: lastBattery?.specialization || null,
    });
  }
  const last = db
    .prepare(
      `SELECT MAX(b.completed_at) AS t FROM batteries b
       WHERE b.candidate_user_id = ? AND b.specialization = ?`
    )
    .get(req.user.id, cat.specialization);
  bumpRetake(last?.t);
  res.json({
    label: cat.label,
    retakeAt,
    cooldownActive: onCooldown,
    specialization: cat.specialization,
    grade: cat.grade,
  });
});

router.get("/invitations", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.salary_from, i.salary_to, i.offer_text, i.contact_channel, i.status, i.created_at,
              e.company_name, e.contact_email AS employer_contact_email,
              n.title AS need_title, n.specialization, n.grade,
              c.status AS call_status
       FROM invitations i
       JOIN employer_profiles e ON e.user_id = i.employer_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.candidate_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(req.user.id);
  res.json({
    items: rows.map((r) => {
      const item = {
        id: r.id,
        salaryFrom: r.salary_from,
        salaryTo: r.salary_to,
        offerText: r.offer_text,
        contactChannel: r.contact_channel,
        status: r.status,
        companyName: r.company_name,
        needTitle: r.need_title,
        needCategory: formatSpecGradeLabel(r.specialization, r.grade),
        callStatus: r.call_status || null,
        createdAt: dbDateToIso(r.created_at),
      };
      if (r.status === "accepted") {
        item.employerContactEmail = r.employer_contact_email;
      }
      return item;
    }),
  });
});

router.get("/past", (req, res) => {
  const db = getDb();
  const appConfig = require("../../config");
  const batteries = db
    .prepare(
      `SELECT b.id, b.specialization, b.claimed_grade, b.completed_at, c.label
       FROM batteries b
       LEFT JOIN categories c ON c.specialization = b.specialization AND c.grade = b.claimed_grade
       WHERE b.candidate_user_id = ? AND b.completed_at IS NOT NULL
       ORDER BY b.completed_at DESC`
    )
    .all(req.user.id);
  const { scoreBatteryAttempts } = require("../assessment/service");
  const batteryItems = batteries.map((b) => {
    const { passed } = scoreBatteryAttempts(b.id, b.claimed_grade);
    let retakeAt = null;
    if (b.completed_at) {
      const d = new Date(dbDateToIso(b.completed_at));
      d.setDate(d.getDate() + Number(appConfig.GRADE_COOLDOWN_DAYS || 90));
      retakeAt = d.toISOString();
    }
    return {
      completedAt: dbDateToIso(b.completed_at),
      label: b.label || `${b.specialization} × ${b.claimed_grade}`,
      outcome: passed ? "категория подтверждена" : "категория не подтверждена",
      retakeAt: passed ? null : retakeAt,
    };
  });
  const invitations = db
    .prepare(
      `SELECT i.status, i.created_at, i.salary_from, i.salary_to, e.company_name, n.title
       FROM invitations i
       JOIN employer_profiles e ON e.user_id = i.employer_user_id
       JOIN employer_needs n ON n.id = i.need_id
       WHERE i.candidate_user_id = ? AND i.status IN ('accepted', 'declined')
       ORDER BY i.created_at DESC`
    )
    .all(req.user.id);
  const calls = db
    .prepare(
      `SELECT c.ended_at, e.company_name, n.title
       FROM invitations i
       JOIN calls c ON c.invitation_id = i.id
       JOIN employer_profiles e ON e.user_id = i.employer_user_id
       JOIN employer_needs n ON n.id = i.need_id
       WHERE i.candidate_user_id = ? AND c.status = 'ended'
       ORDER BY c.ended_at DESC`
    )
    .all(req.user.id);
  res.json({
    batteries: batteryItems,
    invitations: invitations.map((r) => ({
      status: r.status,
      at: dbDateToIso(r.created_at),
      companyName: r.company_name,
      needTitle: r.title,
      salaryFrom: r.salary_from,
      salaryTo: r.salary_to,
    })),
    calls: calls.map((r) => ({
      endedAt: dbDateToIso(r.ended_at),
      companyName: r.company_name,
      needTitle: r.title,
    })),
  });
});

router.get("/calls", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, i.created_at AS invitation_at, i.salary_from, i.salary_to,
              c.id AS call_id, c.status AS call_status,
              c.started_at, c.ended_at, e.company_name, n.title AS need_title
       FROM invitations i
       JOIN employer_profiles e ON e.user_id = i.employer_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.candidate_user_id = ? AND i.status = 'accepted'
       ORDER BY COALESCE(c.ended_at, c.started_at, i.created_at) DESC`
    )
    .all(req.user.id);
  res.json({
    items: rows.map((r) => ({
      invitationId: r.invitation_id,
      invitationAt: dbDateToIso(r.invitation_at),
      salaryFrom: r.salary_from,
      salaryTo: r.salary_to,
      callId: r.call_id,
      callStatus: r.call_status || "ready",
      startedAt: dbDateToIso(r.started_at),
      endedAt: dbDateToIso(r.ended_at),
      companyName: r.company_name,
      needTitle: r.need_title,
      roomUrl: `/call/${r.invitation_id}`,
    })),
  });
});

const { respondToInvitation } = require("../invitations/actions");

router.post("/invitations/:id/accept", (req, res, next) => {
  try {
    res.json(respondToInvitation(req.user.id, req.params.id, "accept", "web"));
  } catch (e) {
    next(e);
  }
});

router.post("/invitations/:id/decline", (req, res, next) => {
  try {
    res.json(respondToInvitation(req.user.id, req.params.id, "decline", "web"));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
