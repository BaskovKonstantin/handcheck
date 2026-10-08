"use strict";

const { companyTestStatusLabel } = require("./company-test-status");

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

function pendingEmployerTestMessage(title) {
  const safe = String(title || "").trim() || "тест компании";
  return `Тест «${safe}» назначится после принятия`;
}

function candidatePendingCompanyTestNote(title) {
  const safe = String(title || "").trim() || "тест компании";
  return `При принятии откроется тест компании «${safe}».`;
}

function pendingCompanyTestRow(db, invitationRow) {
  const pendingId = invitationRow.pending_employer_test_id;
  if (!pendingId) return null;
  if (!["sent", "viewed"].includes(invitationRow.status)) return null;
  const test = db
    .prepare("SELECT id, title FROM employer_tests WHERE id = ?")
    .get(pendingId);
  if (!test) return null;
  return {
    id: `pending-${test.id}`,
    testId: test.id,
    title: test.title,
    status: "pending_accept",
    statusLabel: "Назначится после принятия",
    pendingMessage: pendingEmployerTestMessage(test.title),
  };
}

function buildEmployerInvitationCompanyTests(db, invitationRow) {
  const assignments = listCompanyTestAssignments(db, invitationRow);
  const companyTests = assignments.map((a) => ({
    id: a.id,
    testId: a.test_id,
    title: a.test_title,
    status: a.status,
    statusLabel: companyTestStatusLabel(a.status),
  }));
  const pending = pendingCompanyTestRow(db, invitationRow);
  if (pending) companyTests.push(pending);
  const assignment = assignments.length ? assignments[assignments.length - 1] : null;
  return {
    assignments,
    assignment,
    companyTests,
    hasAssignableCompanyTest: hasAssignableCompanyTest(db, invitationRow.need_id, assignments),
  };
}

function candidatePendingCompanyTestFields(db, invitationRow) {
  const pendingId = invitationRow.pending_employer_test_id;
  if (!pendingId) return {};
  if (!["sent", "viewed"].includes(invitationRow.status)) return {};
  const test = db
    .prepare("SELECT id, title FROM employer_tests WHERE id = ?")
    .get(pendingId);
  if (!test) return {};
  return {
    pendingCompanyTestTitle: test.title,
    pendingCompanyTestNote: candidatePendingCompanyTestNote(test.title),
  };
}

module.exports = {
  listCompanyTestAssignments,
  hasAssignableCompanyTest,
  pendingEmployerTestMessage,
  candidatePendingCompanyTestNote,
  pendingCompanyTestRow,
  buildEmployerInvitationCompanyTests,
  candidatePendingCompanyTestFields,
};
