"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

router.post("/invitations", (req, res, next) => {
  try {
    const {
      needId,
      candidateId,
      salaryFrom,
      salaryTo,
      offerText,
      contactChannel,
    } = req.body || {};
    const from = Number(salaryFrom);
    const to = Number(salaryTo);
    const offer = String(offerText || "").trim();
    const channel = String(contactChannel || "").trim();
    const fields = {};
    if (!Number.isInteger(from) || from < 0) {
      fields.salaryRange = "Укажите целое число в поле «От»";
    }
    if (!Number.isInteger(to) || to < 0) {
      fields.salaryRange = fields.salaryRange || "Укажите целое число в поле «До»";
    }
    if (Number.isInteger(from) && Number.isInteger(to) && from > to) {
      fields.salaryRange = "Вилка зарплаты: «От» не может быть больше «До»";
    }
    if (
      !needId ||
      !candidateId ||
      !offer ||
      !channel ||
      channel.length > 64 ||
      Object.keys(fields).length
    ) {
      throw httpError(400, "invalid_body", Object.keys(fields).length ? { fields } : undefined);
    }
    const db = getDb();
    const need = db
      .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
      .get(needId, req.user.id);
    if (!need) throw httpError(404, "not_found");
    const avail = db
      .prepare("SELECT availability FROM candidate_profiles WHERE user_id = ?")
      .get(candidateId);
    if (avail?.availability === "paused") throw httpError(409, "candidate_paused");
    const review = db
      .prepare(
        `SELECT decision FROM need_reviews WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?`
      )
      .get(req.user.id, needId, candidateId);
    if (review?.decision === "rejected") throw httpError(409, "candidate_rejected");
    if (review?.decision === "later") throw httpError(409, "candidate_deferred");
    const id = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent')`
    ).run(id, req.user.id, needId, candidateId, from, to, offer, channel);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at)
       VALUES (?, ?, ?, ?, 'invited', ?)
       ON CONFLICT(employer_user_id, need_id, candidate_user_id)
       DO UPDATE SET decision = 'invited', updated_at = excluded.updated_at`
    ).run(newId(), req.user.id, needId, candidateId, now);
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

router.get("/invitations", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.*, cp.display_name, cp.phone, cp.contact_email
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       WHERE i.employer_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(req.user.id);
  res.json({
    items: rows.map((r) => {
      const item = {
        id: r.id,
        candidateId: r.candidate_user_id,
        candidateName: r.display_name,
        salaryFrom: r.salary_from,
        salaryTo: r.salary_to,
        status: r.status,
        offerText: r.offer_text,
        contactChannel: r.contact_channel,
      };
      if (r.status === "accepted") {
        item.candidatePhone = r.phone;
        item.candidateContactEmail = r.contact_email;
      }
      return item;
    }),
  });
});

router.get("/calls", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, i.created_at AS invitation_at, i.candidate_user_id, cp.display_name,
              c.id AS call_id, c.status AS call_status, c.started_at, c.ended_at, n.title AS need_title
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.employer_user_id = ? AND i.status = 'accepted'
       ORDER BY COALESCE(c.ended_at, c.started_at, i.created_at) DESC`
    )
    .all(req.user.id);
  res.json({
    items: rows.map((r) => ({
      invitationId: r.invitation_id,
      invitationAt: r.invitation_at,
      callId: r.call_id,
      callStatus: r.call_status || "ready",
      startedAt: r.started_at,
      endedAt: r.ended_at,
      candidateName: r.display_name,
      needTitle: r.need_title,
      roomUrl: `/call/${r.invitation_id}`,
      analysisUrl: r.call_id ? `/api/calls/${r.call_id}/analysis` : null,
    })),
  });
});

router.get("/candidates/:candidateId/contacts", (req, res, next) => {
  const row = getDb()
    .prepare(
      `SELECT cp.phone, cp.contact_email
       FROM invitations i
       INNER JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       WHERE i.employer_user_id = ? AND i.candidate_user_id = ? AND i.status = 'accepted'
       LIMIT 1`
    )
    .get(req.user.id, req.params.candidateId);
  if (!row) return next(httpError(403, "forbidden"));
  res.json({ phone: row.phone, contact_email: row.contact_email });
});

module.exports = router;
