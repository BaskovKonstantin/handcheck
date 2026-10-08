"use strict";

function commonPrefixLen(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
  return i;
}

function tokenizeRu(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[а-яёa-z0-9]+/gi) || [];
}

/**
 * Keyword chips for employer review: substring match, then shared Russian stem (prefix).
 */
function keywordHits(text, keywords) {
  const lower = String(text || "").toLowerCase();
  const tokens = tokenizeRu(text);
  const hits = [];
  for (const kw of keywords || []) {
    const k = String(kw).toLowerCase().trim();
    if (!k) continue;
    if (lower.includes(k)) {
      hits.push(kw);
      continue;
    }
    const minPrefix = Math.min(4, k.length);
    let matched = false;
    for (const t of tokens) {
      const prefixLen = commonPrefixLen(k, t);
      if (prefixLen >= minPrefix) {
        matched = true;
        break;
      }
    }
    if (matched) hits.push(kw);
  }
  return hits;
}

module.exports = { keywordHits, commonPrefixLen, tokenizeRu };
