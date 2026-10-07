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

const QUICK_LEAD_PREFIX =
  /^\s*(?:пункт\s*(?:\d+|первый|второй|третий|четвертый|четвёртый|пятый|шестой|седьмой|восьмой)\s*[.:,-]?\s*|я\s+использую\s+)/i;

function stripQuickLead(text) {
  return String(text || "").replace(QUICK_LEAD_PREFIX, "").trim();
}

function tokenBag(text) {
  return normalizeText(text).split(" ").filter((w) => w.length > 1);
}

function bagJaccardSimilarity(a, b) {
  const sa = new Set(tokenBag(a));
  const sb = new Set(tokenBag(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function tokenMatchesRubricKey(token, keys) {
  if (!token) return false;
  return keys.some((k) => {
    const kn = normalizeText(k);
    return kn && (token === kn || token.includes(kn) || kn.includes(token));
  });
}

function looksLikeProseAnswer(raw, norm) {
  const sentences = String(raw || "")
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/\s/g, "").length > 24);
  if (sentences.length >= 2) return true;
  if (
    /\b(потому что|чтобы|если|когда|через|сначала|затем|поэтому|версионирую|отдаю|логирую|хранятся|масштабиру|делаю|использую)\b/i.test(
      raw
    ) &&
    /[.!?]/.test(raw)
  ) {
    return true;
  }
  const tokens = norm.split(" ").filter(Boolean);
  const verbs =
    tokens.filter((t) =>
      /(ую|ю|ем|им|ать|ить|еть|ыва|ива|ован|ён|ен)$/i.test(t)
    ).length;
  return verbs >= 3 && tokens.length >= 14;
}

function shingleSet(text, size = 3) {
  const words = normalizeText(text).split(" ").filter((w) => w.length > 1);
  const set = new Set();
  for (let i = 0; i <= words.length - size; i += 1) {
    set.add(words.slice(i, i + size).join(" "));
  }
  return set;
}

function jaccardSimilarity(a, b) {
  const sa = shingleSet(a);
  const sb = shingleSet(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function looksLikeKeywordListAnswer(answerText, rubric) {
  const raw = String(answerText || "");
  const body = stripQuickLead(raw);
  const norm = normalizeText(body);
  if (norm.length < 40) return false;
  const keys = rubric?.keys || [];
  if (!keys.length) return false;
  const hits = keys.filter((k) => keyHit(norm, k)).length;
  const keyRatio = hits / keys.length;
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length < 10) return false;
  if (looksLikeProseAnswer(body, norm)) return false;
  const rubricTokenShare =
    tokens.filter((t) => tokenMatchesRubricKey(t, keys)).length / tokens.length;
  if (keyRatio >= 0.45 && rubricTokenShare >= 0.52) return true;
  if (keyRatio >= 0.62 && tokens.length >= 12 && rubricTokenShare >= 0.45) return true;
  return false;
}

function nearDuplicateQuickBodiesMultiplier(quickAttempts) {
  const norms = quickAttempts
    .map((a) => normalizeText(stripQuickLead(a.answer_text || "")))
    .filter((t) => t.replace(/\s/g, "").length > 30);
  if (norms.length < 4) return 1;
  const freq = new Map();
  for (const t of norms) freq.set(t, (freq.get(t) || 0) + 1);
  let maxSame = 0;
  for (const n of freq.values()) maxSame = Math.max(maxSame, n);
  if (maxSame >= 5) return 0.2;
  if (maxSame >= 4) return 0.35;
  if (maxSame >= 3) return 0.55;

  let highSimPairs = 0;
  for (let i = 0; i < norms.length; i += 1) {
    for (let j = i + 1; j < norms.length; j += 1) {
      if (bagJaccardSimilarity(norms[i], norms[j]) >= 0.68) highSimPairs += 1;
    }
  }
  if (highSimPairs >= 12) return 0.2;
  if (highSimPairs >= 8) return 0.35;
  if (highSimPairs >= 5) return 0.55;
  return 1;
}

function keywordTrapMultiplier(quickAttempts, rubricsByAttemptId) {
  let keywordHits = 0;
  for (const a of quickAttempts) {
    const rubric = rubricsByAttemptId?.get?.(a.id) || a.rubric || {};
    if (looksLikeKeywordListAnswer(a.answer_text, rubric)) keywordHits += 1;
  }
  const dupMult = nearDuplicateQuickBodiesMultiplier(quickAttempts);
  if (keywordHits >= 6) return Math.min(dupMult, 0.15);
  if (keywordHits >= 4) return Math.min(dupMult, 0.25);
  if (keywordHits >= 3) return Math.min(dupMult, 0.45);
  return dupMult;
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

function applyBatteryScoreGuards(agg, attempts, options = {}) {
  const quickAttempts = attempts.filter((a) => a.type === "quick");
  const rubricsByAttemptId = options.rubricsByAttemptId;
  const dupMult = duplicateQuickAnswerMultiplier(quickAttempts);
  const trapMult = keywordTrapMultiplier(quickAttempts, rubricsByAttemptId);
  const mult = Math.min(dupMult, trapMult);
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
  looksLikeKeywordListAnswer,
  stripQuickLead,
  bagJaccardSimilarity,
  jaccardSimilarity,
  keywordTrapMultiplier,
  applyBatteryScoreGuards,
  CUTOFFS,
};
