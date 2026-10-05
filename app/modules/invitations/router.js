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
    if (
      !needId ||
      !candidateId ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from > to ||
      !offer ||
      !channel ||
      channel.length > 64
    ) {
      throw httpError(400, "invalid_body");
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
      `SELECT i.*, cp.display_name FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       WHERE i.employer_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(req.user.id);
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      candidateName: r.display_name,
      salaryFrom: r.salary_from,
      salaryTo: r.salary_to,
      status: r.status,
    })),
  });
});

router.get("/candidates/:candidateId/contacts", (req, res, next) => {
  const db = getDb();
  const inv = db
    .prepare(
      `SELECT * FROM invitations WHERE employer_user_id = ? AND candidate_user_id = ? AND status = 'accepted' LIMIT 1`
    )
    .get(req.user.id, req.params.candidateId);
  if (!inv) return next(httpError(403, "forbidden"));
  const p = db
    .prepare("SELECT phone, contact_email FROM candidate_profiles WHERE user_id = ?")
    .get(req.params.candidateId);
  res.json({ phone: p.phone, contact_email: p.contact_email });
});

module.exports = router;
