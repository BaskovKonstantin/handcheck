"use strict";

const { tokenize } = require("./domain-boost");

const RU_SUFFIXES = [
  "ами",
  "ями",
  "ого",
  "ему",
  "ому",
  "ией",
  "ии",
  "ов",
  "ев",
  "ам",
  "ям",
  "ах",
  "ях",
  "ие",
  "ые",
  "ой",
  "ей",
  "ий",
  "ый",
  "ая",
  "яя",
  "ую",
  "юю",
  "ем",
  "ом",
  "е",
  "у",
  "а",
  "я",
  "и",
  "ы",
];

function wordsFromText(text) {
  const lower = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  return lower
    .split(/[^a-zа-я0-9]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

function stemWord(word) {
  let w = String(word || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  if (w.length < 5) return w;
  for (const suffix of RU_SUFFIXES) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      return w.slice(0, -suffix.length);
    }
  }
  if (w.length >= 6) return w.slice(0, w.length - 1);
  return w;
}

function stemsMatch(a, b) {
  if (a === b) return true;
  const minLen = 4;
  const prefixLen = Math.min(a.length, b.length, Math.max(minLen, Math.min(a.length, b.length) - 1));
  if (prefixLen < minLen) return false;
  return a.slice(0, prefixLen) === b.slice(0, prefixLen);
}

/**
 * Keyword overlap between need domain and call transcript (Russian inflection tolerant).
 * Returns matched need-side stems (for logging), not raw transcript tokens.
 */
function domainKeywordHits(needDomainText, transcriptText) {
  const needWords = wordsFromText(needDomainText).filter((w) => w.length >= 5);
  if (!needWords.length) return [];
  const transcriptStems = wordsFromText(transcriptText).map(stemWord);
  const hits = [];
  for (const needWord of needWords) {
    const needStem = stemWord(needWord);
    for (const tStem of transcriptStems) {
      if (stemsMatch(needStem, tStem)) {
        hits.push(needStem);
        break;
      }
    }
  }
  return [...new Set(hits)];
}

module.exports = { wordsFromText, stemWord, domainKeywordHits, tokenize };
