"use strict";

const ALIASES = {
  nodejs: "node",
  "node.js": "node",
  postgresql: "postgres",
  typescript: "ts",
};

function normalizeStackToken(raw) {
  let t = String(raw || "").trim().toLowerCase();
  if (!t) return "";
  t = t.replace(/\.js$/i, "").replace(/\s+/g, "");
  if (ALIASES[t]) t = ALIASES[t];
  return t;
}

function stackMatchesFilter(candidateStack, queryToken) {
  const q = normalizeStackToken(queryToken);
  if (!q) return true;
  return (candidateStack || []).some((s) => normalizeStackToken(s) === q);
}

function stackOverlapTokens(needStack, candidateStack) {
  const needSet = new Set((needStack || []).map(normalizeStackToken).filter(Boolean));
  const hits = [];
  for (const c of candidateStack || []) {
    const n = normalizeStackToken(c);
    if (n && needSet.has(n) && !hits.includes(c)) hits.push(c);
  }
  return hits;
}

module.exports = {
  normalizeStackToken,
  stackMatchesFilter,
  stackOverlapTokens,
};
