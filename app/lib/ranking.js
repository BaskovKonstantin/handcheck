"use strict";

const { domainBoost } = require("./domain-boost");

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
    const rank = computeRank({
      test_score: c.test_score,
      motivation: c.motivation,
      fsp_boost: fb,
      domain_boost: db,
    });
    return { ...c, domain_boost: db, fsp_boost: fb, rank };
  });
  ranked.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return new Date(a.assigned_at) - new Date(b.assigned_at);
  });
  return ranked;
}

module.exports = { computeRank, fspBoost, rankCandidates };
