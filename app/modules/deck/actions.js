"use strict";

const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { httpError } = require("../../middleware/errors");
const { loadCandidatesForNeed, applyFilters } = require("../matching/pool");
const { employerCandidateView } = require("../../lib/privacy");
const { normalizeSource } = require("../assessment/actions");

function getEmployerNeed(employerUserId, needId) {
  return getDb()
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, employerUserId);
}

function getNextDeckCard(employerUserId, needId, query = {}) {
  const need = getEmployerNeed(employerUserId, needId);
  if (!need) throw httpError(404, "not_found");
  let items = loadCandidatesForNeed(need, employerUserId, { forDeck: true });
  items = applyFilters(items, query);
  if (!items.length) return { card: null, candidateId: null };
  const c = items[0];
  const card = employerCandidateView(
    employerUserId,
    {
      id: c.id,
      displayName: c.displayName,
      categoryLabel: c.categoryLabel,
      stack: c.stack,
      backgroundDomains: c.backgroundDomains,
      explanation: c.explanation.slice(0, 2),
      taskPhrases: c.taskPhrases,
      integrationNote: c.integrationNote,
      phone: c.phone,
      contact_email: c.contact_email,
    },
    null
  );
  return { card, candidateId: c.id };
}

function recordNeedReview(employerUserId, needId, candidateId, decision, source = "web") {
  const need = getEmployerNeed(employerUserId, needId);
  if (!need) throw httpError(404, "not_found");
  if (!["rejected", "later", "invited"].includes(decision)) {
    throw httpError(400, "invalid_body");
  }
  const now = new Date().toISOString();
  const src = normalizeSource(source);
  getDb()
    .prepare(
      `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employer_user_id, need_id, candidate_user_id)
       DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at, source = excluded.source`
    )
    .run(newId(), employerUserId, need.id, candidateId, decision, now, src);
  return { ok: true };
}

function createInvitation(employerUserId, body, source = "web") {
  const {
    needId,
    candidateId,
    salaryFrom,
    salaryTo,
    offerText,
    contactChannel,
  } = body || {};
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
  const need = getEmployerNeed(employerUserId, needId);
  if (!need) throw httpError(404, "not_found");
  const avail = db.prepare("SELECT availability FROM candidate_profiles WHERE user_id = ?").get(candidateId);
  if (avail?.availability === "paused") throw httpError(409, "candidate_paused");
  const review = db
    .prepare(
      `SELECT decision FROM need_reviews WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?`
    )
    .get(employerUserId, needId, candidateId);
  if (review?.decision === "rejected") throw httpError(409, "candidate_rejected");
  if (review?.decision === "later") throw httpError(409, "candidate_deferred");
  const id = newId();
  const src = normalizeSource(source);
  db.prepare(
    `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)`
  ).run(id, employerUserId, needId, candidateId, from, to, offer, channel, src);
  recordNeedReview(employerUserId, needId, candidateId, "invited", src);
  return { id };
}

function decideCandidate(employerUserId, needId, candidateId, decision, invitePayload, source = "web") {
  if (decision === "invite") {
    if (!invitePayload) throw httpError(400, "invalid_body");
    return createInvitation(
      employerUserId,
      { needId, candidateId, ...invitePayload },
      source
    );
  }
  if (decision === "reject") {
    return recordNeedReview(employerUserId, needId, candidateId, "rejected", source);
  }
  if (decision === "later") {
    return recordNeedReview(employerUserId, needId, candidateId, "later", source);
  }
  throw httpError(400, "invalid_body");
}

module.exports = {
  getEmployerNeed,
  getNextDeckCard,
  recordNeedReview,
  createInvitation,
  decideCandidate,
};
