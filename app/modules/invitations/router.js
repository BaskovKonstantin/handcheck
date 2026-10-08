"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { createInvitation } = require("./actions");
const { dbDateToIso } = require("../../lib/db-datetime");
const { httpError } = require("../../middleware/errors");
const { publicCandidateDisplayName } = require("../../lib/public-candidate-name");
const { hasAnyPlayableRecording } = require("../../lib/call-recording");
const { companyTestStatusLabel } = require("../../lib/company-test-status");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

function listCompanyTestAssignments(db, invitationRow) {
  let rows = db
    .prepare(
      `SELECT a.id, a.status, a.due_at, t.id AS test_id, t.title AS test_title
       FROM employer_test_assignments a
       JOIN employer_tests t ON t.id = a.test_id
       WHERE a.invitation_id = ?
       ORDER BY a.due_at ASC`
    )
    .all(invitationRow.id);
  if (!rows.length) {
    rows = db
      .prepare(
        `SELECT a.id, a.status, a.due_at, t.id AS test_id, t.title AS test_title
         FROM employer_test_assignments a
         JOIN employer_tests t ON t.id = a.test_id
         WHERE a.candidate_user_id = ? AND t.need_id = ?
         ORDER BY a.due_at ASC`
      )
      .all(invitationRow.candidate_user_id, invitationRow.need_id);
  }
  return rows;
}

function hasAssignableCompanyTest(db, needId, assignments) {
  const published = db
    .prepare(`SELECT id FROM employer_tests WHERE need_id = ? AND status = 'published'`)
    .all(needId);
  const blocked = new Set();
  for (const a of assignments) {
    if (["assigned", "started", "submitted"].includes(a.status)) {
      blocked.add(a.test_id);
    }
  }
  return published.some((t) => !blocked.has(t.id));
}

router.post("/invitations", (req, res, next) => {
  try {
    const result = createInvitation(req.user.id, req.body || {}, "web");
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

router.get("/invitations", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.*, cp.display_name, cp.phone, cp.contact_email, n.title AS need_title, u.email AS candidate_email,
              c.status AS call_status
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       JOIN users u ON u.id = i.candidate_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.employer_user_id = ?
         AND (
           (SELECT is_test FROM users WHERE id = i.candidate_user_id) = 0
           OR (SELECT is_test FROM users WHERE id = ?) = 1
         )
       ORDER BY i.created_at DESC`
    )
    .all(req.user.id, req.user.id);
  res.json({
    items: rows.map((r) => {
      const db = getDb();
      const assignments = listCompanyTestAssignments(db, r);
      const assignment = assignments.length ? assignments[assignments.length - 1] : null;
      const companyTests = assignments.map((a) => ({
        id: a.id,
        testId: a.test_id,
        title: a.test_title,
        status: a.status,
        statusLabel: companyTestStatusLabel(a.status),
      }));
      const item = {
        id: r.id,
        candidateId: r.candidate_user_id,
        candidateName: publicCandidateDisplayName(r.display_name, r.candidate_email),
        needId: r.need_id,
        needTitle: r.need_title,
        callStatus: r.call_status || null,
        salaryFrom: r.salary_from,
        salaryTo: r.salary_to,
        status: r.status,
        offerText: r.offer_text,
        contactChannel: r.contact_channel,
        createdAt: dbDateToIso(r.created_at),
        viaAiClient: r.action_source === "mcp",
        companyTestAssignmentId: assignment?.id || null,
        companyTestAssignmentStatus: assignment?.status || null,
        companyTestAssignmentStatusLabel: assignment?.status
          ? companyTestStatusLabel(assignment.status)
          : null,
        companyTests,
        hasAssignableCompanyTest: hasAssignableCompanyTest(db, r.need_id, assignments),
      };
      if (r.status === "accepted") {
        item.candidatePhone = r.phone;
        item.candidateContactEmail = r.contact_email;
      }
      const hadPriorDecline = Boolean(
        getDb()
          .prepare(
            `SELECT 1 FROM invitations i2
             WHERE i2.employer_user_id = ? AND i2.need_id = ? AND i2.candidate_user_id = ?
               AND i2.status = 'declined' AND i2.created_at < ? LIMIT 1`
          )
          .get(req.user.id, r.need_id, r.candidate_user_id, r.created_at)
      );
      item.hadPriorDecline = hadPriorDecline;
      return item;
    }),
  });
});

router.get("/calls", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, i.created_at AS invitation_at, i.candidate_user_id, cp.display_name, u.email AS candidate_email,
              i.salary_from, i.salary_to,
              c.id AS call_id, c.status AS call_status, c.started_at, c.ended_at, n.title AS need_title,
              c.recording_path
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       JOIN users u ON u.id = i.candidate_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.employer_user_id = ? AND i.status = 'accepted'
       ORDER BY COALESCE(c.ended_at, c.started_at, i.created_at) DESC`
    )
    .all(req.user.id);
  res.json({
    items: rows.map((r) => ({
      invitationId: r.invitation_id,
      candidateId: r.candidate_user_id,
      invitationAt: dbDateToIso(r.invitation_at),
      callId: r.call_id,
      callStatus: r.call_status || "ready",
      startedAt: dbDateToIso(r.started_at),
      endedAt: dbDateToIso(r.ended_at),
      candidateName: publicCandidateDisplayName(r.display_name, r.candidate_email),
      needTitle: r.need_title,
      salaryFrom: r.salary_from,
      salaryTo: r.salary_to,
      hasRecording: hasAnyPlayableRecording(r.recording_path),
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
  res.json({ phone: row.phone, contactEmail: row.contact_email });
});

module.exports = router;
