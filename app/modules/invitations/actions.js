"use strict";

const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { httpError } = require("../../middleware/errors");

const { parseSalaryRange } = require("../../lib/salary-range");
const { assertCandidateInNeedPool } = require("../../lib/invitation-pool");

function findActiveInvitation(db, needId, candidateId) {
  return db
    .prepare(
      `SELECT id, status FROM invitations
       WHERE need_id = ? AND candidate_user_id = ? AND status IN ('sent', 'viewed', 'accepted')`
    )
    .get(needId, candidateId);
}

function createInvitation(employerUserId, body, actionSource = "web") {
  const {
    needId,
    candidateId,
    salaryFrom,
    salaryTo,
    offerText,
    contactChannel,
    employerTestId,
  } = body || {};
  if (!needId || !candidateId) {
    throw httpError(400, "invalid_body");
  }
  const db = getDb();
  const need = db
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, employerUserId);
  if (!need) throw httpError(404, "not_found");
  const { fields, from, to } = parseSalaryRange(salaryFrom, salaryTo);
  const offer = String(offerText || "").trim();
  const channel = String(contactChannel || "").trim();
  if (!offer) fields.offerText = "Напишите текст приглашения";
  else if (offer.length > 2000) fields.offerText = "Текст приглашения слишком длинный (максимум 2000 символов)";
  if (!channel) fields.contactChannel = "Укажите канал связи";
  else if (channel.length > 64) fields.contactChannel = "Канал связи слишком длинный";
  if (Object.keys(fields).length) {
    throw httpError(400, "invalid_body", { fields });
  }
  const company = db
    .prepare("SELECT company_name FROM employer_profiles WHERE user_id = ?")
    .get(employerUserId);
  if (!String(company?.company_name || "").trim()) {
    throw httpError(400, "invalid_body", {
      fields: { companyName: "Заполните профиль компании" },
    });
  }
  if (!need.active) {
    throw httpError(409, "need_inactive", {
      message: "Потребность неактивна — новые приглашения отправить нельзя",
    });
  }
  const avail = db
    .prepare("SELECT availability FROM candidate_profiles WHERE user_id = ?")
    .get(candidateId);
  if (avail?.availability === "paused") throw httpError(409, "candidate_paused");
  const review = db
    .prepare(
      `SELECT decision FROM need_reviews WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?`
    )
    .get(employerUserId, needId, candidateId);
  if (review?.decision === "rejected") throw httpError(409, "candidate_rejected");
  if (review?.decision === "later") throw httpError(409, "candidate_deferred");
  assertCandidateInNeedPool(employerUserId, need, candidateId);
  const existing = findActiveInvitation(db, needId, candidateId);
  if (existing) {
    const message =
      existing.status === "accepted"
        ? "Кандидат уже принял приглашение по этой потребности — контакты в разделе «Приглашения»"
        : "Приглашение по этой потребности уже отправлено — дождитесь ответа кандидата";
    throw httpError(409, "invitation_duplicate", { message });
  }
  const id = newId();
  const src = actionSource === "mcp" ? "mcp" : "web";
  db.prepare(
    `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status, action_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)`
  ).run(id, employerUserId, needId, candidateId, from, to, offer, channel, src);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at)
     VALUES (?, ?, ?, ?, 'invited', ?)
     ON CONFLICT(employer_user_id, need_id, candidate_user_id)
     DO UPDATE SET decision = 'invited', updated_at = excluded.updated_at`
  ).run(newId(), employerUserId, needId, candidateId, now);
  if (employerTestId) {
    const test = db
      .prepare(
        "SELECT id, need_id, status FROM employer_tests WHERE id = ? AND employer_user_id = ?"
      )
      .get(String(employerTestId), employerUserId);
    if (!test) throw httpError(404, "not_found");
    if (test.need_id !== needId) {
      throw httpError(400, "invalid_body", {
        fields: { employerTestId: "Тест привязан к другой потребности" },
      });
    }
    if (test.status !== "published") {
      throw httpError(409, "test_not_published", { message: "Опубликуйте тест перед назначением" });
    }
    db.prepare("UPDATE invitations SET pending_employer_test_id = ? WHERE id = ?").run(
      test.id,
      id
    );
  }
  return { id };
}

function respondToInvitation(candidateUserId, invitationId, decision, actionSource = "web") {
  const db = getDb();
  const inv = db
    .prepare("SELECT * FROM invitations WHERE id = ? AND candidate_user_id = ?")
    .get(invitationId, candidateUserId);
  if (!inv) throw httpError(404, "not_found");
  if (inv.status !== "sent") throw httpError(409, "invitation_final");
  if (!["accept", "decline"].includes(decision)) {
    throw httpError(400, "invalid_body");
  }
  const status = decision === "accept" ? "accepted" : "declined";
  const src = actionSource === "mcp" ? "mcp" : "web";
  const pendingTestId = inv.pending_employer_test_id || null;
  db.prepare("UPDATE invitations SET status = ?, action_source = ? WHERE id = ?").run(
    status,
    src,
    inv.id
  );
  const { assignCompanyTest, cancelOpenAssignmentsForInvitation } = require("../../lib/company-test-flow");
  if (status === "declined") {
    cancelOpenAssignmentsForInvitation(db, inv.id);
    db.prepare("UPDATE invitations SET pending_employer_test_id = NULL WHERE id = ?").run(inv.id);
  } else if (pendingTestId) {
    assignCompanyTest(db, inv.employer_user_id, pendingTestId, {
      candidateId: inv.candidate_user_id,
      invitationId: inv.id,
    });
    db.prepare("UPDATE invitations SET pending_employer_test_id = NULL WHERE id = ?").run(inv.id);
  }
  return { ok: true, status };
}

module.exports = {
  parseSalaryRange,
  createInvitation,
  respondToInvitation,
  findActiveInvitation,
};
