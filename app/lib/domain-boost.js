"use strict";

const SYNONYM_GROUPS = [["официант", "зал", "horeca", "ресторан", "гость"]];

const LEMMA = {
  официанта: "официант",
  официантов: "официант",
  официанты: "официант",
  гостей: "гость",
  гостя: "гость",
  ресторана: "ресторан",
  ресторане: "ресторан",
};

function tokenize(text) {
  const lower = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  const raw = lower.split(/[^a-zа-я0-9]+/i).filter((t) => t.length >= 3);
  const expanded = new Set();
  for (const t of raw) {
    const lemma = LEMMA[t] || t;
    expanded.add(lemma);
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(lemma)) {
        for (const g of group) expanded.add(g);
      }
    }
  }
  return expanded;
}

function episodeTokens(episodes) {
  const set = new Set();
  for (const ep of episodes) {
    for (const field of [ep.role_title, ep.domain, ep.industry]) {
      for (const t of tokenize(field)) set.add(t);
    }
  }
  return set;
}

function domainBoost(needDomainText, episodes) {
  const needSet = tokenize(needDomainText);
  if (needSet.size === 0) return 0;
  const epSet = episodeTokens(episodes);
  if (epSet.size === 0) return 0;
  let inter = 0;
  for (const t of needSet) {
    if (epSet.has(t)) inter += 1;
  }
  const ratio = inter / Math.max(1, needSet.size);
  return Math.max(0, Math.min(1, ratio));
}

module.exports = { SYNONYM_GROUPS, LEMMA, tokenize, domainBoost };
