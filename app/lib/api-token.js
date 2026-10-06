"use strict";

const crypto = require("crypto");

const TOKEN_PREFIX = "hc_";

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function generateTokenMaterial() {
  const secret = crypto.randomBytes(32).toString("hex");
  const raw = `${TOKEN_PREFIX}${secret}`;
  return {
    raw,
    hash: hashToken(raw),
    displayPrefix: `${raw.slice(0, 14)}…`,
  };
}

function parseBearerAuthorization(header) {
  if (!header || typeof header !== "string") return null;
  const m = header.match(/^Bearer\s+(\S+)\s*$/i);
  if (!m) return null;
  const token = m[1];
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null;
  return token;
}

function normalizeScopes(scopes) {
  const allowed = new Set(["read", "write"]);
  const out = [];
  for (const s of scopes || []) {
    const v = String(s).trim().toLowerCase();
    if (allowed.has(v) && !out.includes(v)) out.push(v);
  }
  if (!out.length) out.push("read");
  return out;
}

function scopesAllow(scopesJson, need) {
  const scopes = JSON.parse(scopesJson || "[]");
  if (need === "write") return scopes.includes("write");
  return scopes.includes("read") || scopes.includes("write");
}

module.exports = {
  TOKEN_PREFIX,
  hashToken,
  generateTokenMaterial,
  parseBearerAuthorization,
  normalizeScopes,
  scopesAllow,
};
