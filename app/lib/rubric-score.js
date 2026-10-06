"use strict";

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keyHit(answerNorm, key) {
  const k = normalizeText(key);
  if (!k) return false;
  return answerNorm.includes(k);
}

function scoreQuick(answerText, rubric) {
  const norm = normalizeText(answerText);
  const keys = rubric.keys || [];
  const breadthKeys = rubric.breadthKeys || [];
  const knowledge =
    keys.length === 0
      ? 0
      : keys.filter((k) => keyHit(norm, k)).length / keys.length;
  let breadth;
  if (breadthKeys.length === 0) {
    breadth = knowledge;
  } else {
    breadth = breadthKeys.filter((k) => keyHit(norm, k)).length / breadthKeys.length;
  }
  return { knowledge, breadth };
}

function scoreWork(answerText, rubric) {
  const norm = normalizeText(answerText);
  const keys = rubric.keys || [];
  const workItems = rubric.workItems || [];
  const knowledge =
    keys.length === 0
      ? 0
      : keys.filter((k) => keyHit(norm, k)).length / keys.length;
  let breadth = 0;
  if (workItems.length > 0) {
    const hit = workItems.filter((item) => {
      const phrases = item.phrases || [];
      return phrases.some((p) => keyHit(norm, p));
    }).length;
    breadth = hit / workItems.length;
  }
  return { knowledge, breadth };
}

function aggregateBattery(quickScores, workScore) {
  const qk =
    quickScores.length === 0
      ? 0
      : quickScores.reduce((s, x) => s + x.knowledge, 0) / quickScores.length;
  const qb =
    quickScores.length === 0
      ? 0
      : quickScores.reduce((s, x) => s + x.breadth, 0) / quickScores.length;
  const knowledge = 0.5 * qk + 0.5 * workScore.knowledge;
  const breadth = 0.5 * qb + 0.5 * workScore.breadth;
  const test_score = 0.6 * knowledge + 0.4 * breadth;
  return { knowledge, breadth, test_score };
}

const CUTOFFS = { junior: 0.55, middle: 0.68, senior: 0.78 };

function cutoffForGrade(grade) {
  return CUTOFFS[grade] ?? CUTOFFS.middle;
}

module.exports = {
  normalizeText,
  keyHit,
  scoreQuick,
  scoreWork,
  aggregateBattery,
  cutoffForGrade,
  CUTOFFS,
};
