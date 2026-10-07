"use strict";

const { publicCandidateDisplayName } = require("./public-candidate-name");
const { unconfirmedLabelForNeed } = require("./category-status");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseDeferredListQuery(query = {}) {
  let limit = Number(query.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(Math.floor(limit), MAX_LIMIT);

  let offset = Number(query.offset);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  const page = Number(query.page);
  if (Number.isFinite(page) && page >= 1) {
    offset = Math.floor((page - 1) * limit);
  }

  if (query.cursor !== undefined && query.cursor !== null && String(query.cursor) !== "") {
    const cursor = Number(query.cursor);
    if (Number.isFinite(cursor) && cursor >= 0) offset = Math.floor(cursor);
  }

  return { limit, offset };
}

function listDeferredCandidates(db, need, employerUserId, query = {}) {
  const { limit, offset } = parseDeferredListQuery(query);
  const baseWhere = `nr.need_id = ? AND nr.employer_user_id = ? AND nr.decision = 'later'`;
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM need_reviews nr WHERE ${baseWhere}`)
    .get(need.id, employerUserId).c;

  const rows = db
    .prepare(
      `SELECT nr.candidate_user_id, nr.updated_at, cp.display_name, u.email, c.label AS category_label
       FROM need_reviews nr
       JOIN candidate_profiles cp ON cp.user_id = nr.candidate_user_id
       JOIN users u ON u.id = nr.candidate_user_id
       LEFT JOIN candidate_categories cc ON cc.candidate_user_id = nr.candidate_user_id
         AND cc.specialization = ? AND cc.grade = ?
       LEFT JOIN categories c ON c.id = cc.category_id
       WHERE ${baseWhere}
       ORDER BY nr.updated_at DESC, nr.candidate_user_id ASC
       LIMIT ? OFFSET ?`
    )
    .all(need.specialization, need.grade, need.id, employerUserId, limit, offset);

  const fallbackLabel = unconfirmedLabelForNeed(need);
  const items = rows.map((r) => ({
    candidateId: r.candidate_user_id,
    displayName: publicCandidateDisplayName(r.display_name, r.email),
    categoryLabel: r.category_label || fallbackLabel,
    deferredAt: r.updated_at,
  }));

  const nextOffset = offset + items.length;
  return {
    items,
    total,
    limit,
    offset,
    hasMore: nextOffset < total,
    nextCursor: nextOffset < total ? nextOffset : null,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseDeferredListQuery,
  listDeferredCandidates,
};
