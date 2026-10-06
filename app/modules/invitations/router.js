"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { createInvitation } = require("../deck/actions");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

router.post("/invitations", (req, res, next) => {
  try {
    const result = createInvitation(req.user.id, req.body, "web");
    res.status(201).json(result);
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
        createdAt: r.created_at,
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
