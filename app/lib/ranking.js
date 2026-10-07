"use strict";

const { domainBoost } = require("./domain-boost");
const {
  CATEGORY_STATUS_CONFIRMED,
  applyUnconfirmedRankPenalty,
} = require("./category-status");

function fspBoost(hasAchievements) {
  return hasAchievements ? 1 : 0;
}

function computeRank({ test_score, motivation, fsp_boost, domain_boost }) {
  return (
    0.6 * test_score +
    0.15 * motivation +
    0.1 * fsp_boost +
    0.15 * domain_boost
  );
}

function rankCandidates(candidates, need) {
  const ranked = candidates.map((c) => {
    const db = domainBoost(need.domain_text, c.episodes || []);
    const fb = fspBoost(c.hasFsp);
    const categoryStatus = c.categoryStatus || CATEGORY_STATUS_CONFIRMED;
    const rawRank = computeRank({
      test_score: c.test_score,
      motivation: c.motivation,
      fsp_boost: fb,
      domain_boost: db,
    });
    const rank = applyUnconfirmedRankPenalty(rawRank, categoryStatus);
    return { ...c, domain_boost: db, fsp_boost: fb, rank, categoryStatus };
  });
  ranked.sort((a, b) => {
    const aConfirmed = a.categoryStatus === CATEGORY_STATUS_CONFIRMED;
    const bConfirmed = b.categoryStatus === CATEGORY_STATUS_CONFIRMED;
    if (aConfirmed !== bConfirmed) return aConfirmed ? -1 : 1;
    if (b.rank !== a.rank) return b.rank - a.rank;
    const aAt = a.assigned_at ? new Date(a.assigned_at).getTime() : 0;
    const bAt = b.assigned_at ? new Date(b.assigned_at).getTime() : 0;
    return aAt - bAt;
  });
  return ranked;
}

module.exports = { computeRank, fspBoost, rankCandidates };
