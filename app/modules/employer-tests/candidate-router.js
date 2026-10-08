"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { dbDateToIso } = require("../../lib/db-datetime");
const { companyTestStatusLabel } = require("../../lib/company-test-status");
const {
  loadAssignmentForCandidate,
  listItems,
  openCurrentItem,
  submitItemAnswer,
  buildCandidateAssignmentJson,
  expireCurrentItemIfNeeded,
  assertAssignmentPlayable,
} = require("../../lib/company-test-flow");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("candidate"));

router.get("/company-tests", (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.status, a.due_at, a.started_at, a.submitted_at, a.invitation_id, t.title, t.intro,
              e.company_name
       FROM employer_test_assignments a
       JOIN employer_tests t ON t.id = a.test_id
       JOIN employer_profiles e ON e.user_id = t.employer_user_id
       WHERE a.candidate_user_id = ?
         AND a.status != 'cancelled'
       ORDER BY a.due_at ASC`
    )
    .all(req.user.id);
  res.json({
    items: rows
      .filter((r) => {
        if (r.status === "submitted") return true;
        if (!r.invitation_id) return true;
        const inv = db
          .prepare("SELECT status FROM invitations WHERE id = ?")
          .get(r.invitation_id);
        return inv?.status === "accepted";
      })
      .map((r) => ({
      id: r.id,
      status: r.status,
      statusLabel: companyTestStatusLabel(r.status),
      dueAt: dbDateToIso(r.due_at),
      startedAt: dbDateToIso(r.started_at),
      submittedAt: dbDateToIso(r.submitted_at),
      title: r.title,
      intro: r.intro,
      companyName: r.company_name,
    })),
  });
});

router.get("/company-tests/:assignmentId", (req, res, next) => {
  try {
    const db = getDb();
    let assignment = loadAssignmentForCandidate(db, req.params.assignmentId, req.user.id);
    assertAssignmentPlayable(db, assignment);
    const payload = buildCandidateAssignmentJson(db, assignment, {
      syncExpiry: assignment.status === "started",
    });
    res.json({
      ...payload,
      dueAt: dbDateToIso(payload.dueAt),
    });
  } catch (e) {
    next(e);
  }
});

router.post("/company-tests/:assignmentId/start", (req, res, next) => {
  try {
    const db = getDb();
    const assignment = loadAssignmentForCandidate(db, req.params.assignmentId, req.user.id);
    if (assignment.status === "submitted") {
      return res.json({ ok: true, status: "submitted", statusLabel: companyTestStatusLabel("submitted") });
    }
    assertAssignmentPlayable(db, assignment);
    const items = listItems(db, assignment.test_id);
    if (!items.length) throw httpError(409, "invalid_state", { message: "В тесте нет вопросов" });
    openCurrentItem(db, assignment, items);
    res.json({ ok: true, status: "started", statusLabel: companyTestStatusLabel("started") });
  } catch (e) {
    next(e);
  }
});

router.post("/company-tests/:assignmentId/answers", (req, res, next) => {
  try {
    const db = getDb();
    let assignment = loadAssignmentForCandidate(db, req.params.assignmentId, req.user.id);
    if (assignment.status === "submitted") {
      throw httpError(409, "already_submitted", { message: "Тест уже сдан" });
    }
    assertAssignmentPlayable(db, assignment);
    const items = listItems(db, assignment.test_id);
    const itemId = String(req.body?.itemId || assignment.current_item_id || "");
    const item = items.find((x) => x.id === itemId);
    if (!item) throw httpError(400, "invalid_body", { fields: { itemId: "Вопрос не найден" } });
    if (assignment.current_item_id && assignment.current_item_id !== itemId) {
      throw httpError(409, "invalid_state", { message: "Сначала ответьте на текущий вопрос" });
    }
    const result = submitItemAnswer(db, assignment, item, req.body || {});
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/company-tests/:assignmentId/submit", (req, res, next) => {
  try {
    const db = getDb();
    let assignment = loadAssignmentForCandidate(db, req.params.assignmentId, req.user.id);
    if (assignment.status === "submitted") return res.json({ ok: true });
    assertAssignmentPlayable(db, assignment);
    const items = listItems(db, assignment.test_id);
    assignment = expireCurrentItemIfNeeded(db, assignment, items);
    const pending = items.filter((it) => {
      const ans = db
        .prepare("SELECT submitted_at FROM employer_test_answers WHERE assignment_id = ? AND item_id = ?")
        .get(assignment.id, it.id);
      return !ans?.submitted_at;
    });
    if (pending.length) {
      throw httpError(409, "invalid_state", {
        message: "Ответьте на все вопросы перед отправкой",
      });
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE employer_test_assignments SET status = 'submitted', submitted_at = ? WHERE id = ?`
    ).run(now, assignment.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
