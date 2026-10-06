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
  if (Array.isArray(key)) {
    return key.some((part) => keyHit(answerNorm, part));
  }
  const k = normalizeText(key);
  if (!k) return false;
  return answerNorm.includes(k);
}

function scoreKeyList(answerNorm, keys) {
  if (!keys.length) return 0;
  const hits = keys.filter((k) => keyHit(answerNorm, k)).length;
  return hits / keys.length;
}

function scoreQuick(answerText, rubric) {
  const norm = normalizeText(answerText);
  const keys = rubric.keys || [];
  const breadthKeys = rubric.breadthKeys || [];
  const knowledge = scoreKeyList(norm, keys);
  let breadth;
  if (breadthKeys.length === 0) {
    breadth = knowledge;
  } else {
    breadth = scoreKeyList(norm, breadthKeys);
  }
  const minLen = rubric.minLength || 0;
  if (minLen > 0 && norm.replace(/\s/g, "").length < minLen) {
    return { knowledge: knowledge * 0.5, breadth: breadth * 0.5 };
  }
  return { knowledge, breadth };
}

function scoreWork(answerText, rubric) {
  const norm = normalizeText(answerText);
  const keys = rubric.keys || [];
  const workItems = rubric.workItems || [];
  const knowledge = scoreKeyList(norm, keys);
  let breadth = 0;
  if (workItems.length > 0) {
    const hit = workItems.filter((item) => {
      const phrases = item.phrases || [];
      return phrases.some((p) => keyHit(norm, p));
    }).length;
    breadth = hit / workItems.length;
  } else if ((rubric.breadthKeys || []).length) {
    breadth = scoreKeyList(norm, rubric.breadthKeys);
  }
  const minLen = rubric.minLength || 120;
  if (norm.replace(/\s/g, "").length >= minLen) {
    return {
      knowledge: Math.min(1, knowledge + 0.15),
      breadth: Math.min(1, breadth + 0.1),
    };
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

/** Penalize identical or copy-pasted answers across quick questions. */
function duplicateQuickAnswerMultiplier(quickAttempts) {
  const texts = quickAttempts
    .map((a) => normalizeText(a.answer_text || ""))
    .filter((t) => t.replace(/\s/g, "").length > 40);
  if (texts.length < 4) return 1;
  const freq = new Map();
  for (const t of texts) freq.set(t, (freq.get(t) || 0) + 1);
  let maxDup = 0;
  for (const n of freq.values()) maxDup = Math.max(maxDup, n);
  if (maxDup >= 5) return 0.2;
  if (maxDup >= 4) return 0.35;
  if (maxDup >= 3) return 0.55;
  if (freq.size <= 2 && texts.length >= 6) return 0.45;
  return 1;
}

function applyBatteryScoreGuards(agg, attempts) {
  const quickAttempts = attempts.filter((a) => a.type === "quick");
  const mult = duplicateQuickAnswerMultiplier(quickAttempts);
  if (mult >= 1) return agg;
  return {
    knowledge: agg.knowledge * mult,
    breadth: agg.breadth * mult,
    test_score: agg.test_score * mult,
  };
}

module.exports = {
  normalizeText,
  keyHit,
  scoreQuick,
  scoreWork,
  aggregateBattery,
  cutoffForGrade,
  duplicateQuickAnswerMultiplier,
  applyBatteryScoreGuards,
  CUTOFFS,
};
