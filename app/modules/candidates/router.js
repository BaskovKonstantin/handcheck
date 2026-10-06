"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("candidate"));

router.get("/profile", (req, res) => {
  const db = getDb();
  const p = db
    .prepare("SELECT * FROM candidate_profiles WHERE user_id = ?")
    .get(req.user.id);
  res.json({
    displayName: p.display_name,
    stack: JSON.parse(p.stack_json || "[]"),
    phone: p.phone,
    contactEmail: p.contact_email,
    availability: p.availability,
  });
});

router.put("/profile", (req, res, next) => {
  try {
    const displayName = String(req.body?.displayName || "").trim();
    const stack = Array.isArray(req.body?.stack) ? req.body.stack : [];
    const phone = String(req.body?.phone || "").trim();
    const contactEmail = String(req.body?.contactEmail || "").trim();
    getDb()
      .prepare(
        `UPDATE candidate_profiles SET display_name = ?, stack_json = ?, phone = ?, contact_email = ?
         WHERE user_id = ?`
      )
      .run(displayName, JSON.stringify(stack), phone, contactEmail, req.user.id);
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
  res.json({ items: rows });
});

router.post("/background", (req, res) => {
  const id = newId();
  const { roleTitle = "", domain = "", industry = "", note = "" } = req.body || {};
  getDb()
    .prepare(
      `INSERT INTO background_episodes (id, candidate_user_id, role_title, domain, industry, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, req.user.id, roleTitle, domain, industry, note);
  res.status(201).json({ id });
});

router.delete("/background/:id", (req, res) => {
  getDb()
    .prepare("DELETE FROM background_episodes WHERE id = ? AND candidate_user_id = ?")
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.put("/availability", (req, res, next) => {
  const v = req.body?.availability;
  if (!["open", "paused"].includes(v)) return next(httpError(400, "invalid_availability"));
  getDb()
    .prepare("UPDATE candidate_profiles SET availability = ? WHERE user_id = ?")
    .run(v, req.user.id);
  res.json({ ok: true });
});

router.get("/category", (req, res) => {
  const db = getDb();
  const cat = db
    .prepare(
      `SELECT cc.*, c.label FROM candidate_categories cc
       JOIN categories c ON c.id = cc.category_id WHERE cc.candidate_user_id = ?`
    )
    .get(req.user.id);
  if (!cat) return res.json({ label: null, retakeAt: null });
  const last = db
    .prepare(
      `SELECT MAX(b.completed_at) AS t FROM batteries b
       WHERE b.candidate_user_id = ? AND b.specialization = ?`
    )
    .get(req.user.id, cat.specialization);
  let retakeAt = null;
  if (last?.t) {
    const d = new Date(last.t);
    d.setDate(d.getDate() + Number(process.env.GRADE_COOLDOWN_DAYS || 90));
    retakeAt = d.toISOString();
  }
  res.json({ label: cat.label, retakeAt });
});

router.get("/invitations", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.salary_from, i.salary_to, i.offer_text, i.contact_channel, i.status, i.created_at,
              e.company_name, e.contact_email AS employer_contact_email
       FROM invitations i
       JOIN employer_profiles e ON e.user_id = i.employer_user_id
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
        createdAt: r.created_at,
      };
      if (r.status === "accepted") {
        item.employerContactEmail = r.employer_contact_email;
      }
      return item;
    }),
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
      invitationAt: r.invitation_at,
      salaryFrom: r.salary_from,
      salaryTo: r.salary_to,
      callId: r.call_id,
      callStatus: r.call_status || "ready",
      startedAt: r.started_at,
      endedAt: r.ended_at,
      companyName: r.company_name,
      needTitle: r.need_title,
      roomUrl: `/call/${r.invitation_id}`,
    })),
  });
});

router.post("/invitations/:id/accept", (req, res, next) => {
  const db = getDb();
  const inv = db
    .prepare("SELECT * FROM invitations WHERE id = ? AND candidate_user_id = ?")
    .get(req.params.id, req.user.id);
  if (!inv) return next(httpError(404, "not_found"));
  db.prepare("UPDATE invitations SET status = 'accepted' WHERE id = ?").run(inv.id);
  res.json({ ok: true });
});

router.post("/invitations/:id/decline", (req, res, next) => {
  const db = getDb();
  const inv = db
    .prepare("SELECT * FROM invitations WHERE id = ? AND candidate_user_id = ?")
    .get(req.params.id, req.user.id);
  if (!inv) return next(httpError(404, "not_found"));
  db.prepare("UPDATE invitations SET status = 'declined' WHERE id = ?").run(inv.id);
  res.json({ ok: true });
});

module.exports = router;
