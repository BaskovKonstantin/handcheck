"use strict";

const crypto = require("crypto");
const { newId } = require("./ids");
const { hashCode } = require("./tokens");
const { getDb } = require("../db");

const TOKEN_PREFIX = "hc_";

function parseScopes(raw) {
  if (!Array.isArray(raw) || !raw.length) return ["read"];
  const out = [];
  for (const s of raw) {
    const v = String(s).trim().toLowerCase();
    if (v === "read" || v === "write") out.push(v);
  }
  return out.length ? [...new Set(out)] : ["read"];
}

function generateApiToken() {
  const secret = crypto.randomBytes(24).toString("base64url");
  const plain = `${TOKEN_PREFIX}${secret}`;
  return { plain, hash: hashCode(plain), prefix: plain.slice(0, 12) };
}

function createApiToken(userId, name, scopes) {
  const db = getDb();
  const id = newId();
  const { plain, hash, prefix } = generateApiToken();
  const scopeList = parseScopes(scopes);
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, String(name || "Токен").trim().slice(0, 80), hash, prefix, JSON.stringify(scopeList));
  return { id, token: plain, scopes: scopeList, prefix };
}

function listApiTokens(userId) {
  return getDb()
    .prepare(
      `SELECT id, name, token_prefix, scopes_json, created_at, last_used_at, revoked_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.token_prefix,
      scopes: JSON.parse(r.scopes_json || "[]"),
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revoked: Boolean(r.revoked_at),
    }));
}

function revokeApiToken(userId, tokenId) {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM api_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(tokenId, userId);
  if (!row) return false;
  db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?").run(tokenId);
  return true;
}

function resolveBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== "string") return null;
  const m = authorizationHeader.match(/^Bearer\s+(hc_[A-Za-z0-9_-]+)$/i);
  if (!m) return null;
  const plain = m[1];
  const hash = hashCode(plain);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.id, t.user_id, t.scopes_json, t.revoked_at, u.email, u.role, u.email_confirmed_at
       FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`
    )
    .get(hash);
  if (!row || row.revoked_at) return null;
  if (!row.email_confirmed_at) return null;
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return {
    id: row.id,
    userId: row.user_id,
    scopes: JSON.parse(row.scopes_json || "[]"),
    user: {
      id: row.user_id,
      email: row.email,
      role: row.role,
      email_confirmed_at: row.email_confirmed_at,
    },
  };
}

function hasScope(token, scope) {
  return Array.isArray(token.scopes) && token.scopes.includes(scope);
}

function listMcpAudit(userId, limit = 50) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return getDb()
    .prepare(
      `SELECT a.id, a.tool_name, a.result_summary, a.ok, a.created_at, t.name AS token_name, t.token_prefix
       FROM mcp_audit_log a
       LEFT JOIN api_tokens t ON t.id = a.token_id
       WHERE a.user_id = ?
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(userId, lim)
    .map((r) => ({
      id: r.id,
      tool: r.tool_name,
      summary: r.result_summary,
      ok: Boolean(r.ok),
      at: r.created_at,
      tokenName: r.token_name,
      tokenPrefix: r.token_prefix,
    }));
}

function logMcpCall({ tokenId, userId, toolName, summary, ok = true }) {
  getDb()
    .prepare(
      `INSERT INTO mcp_audit_log (token_id, user_id, tool_name, result_summary, ok)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(tokenId || null, userId, toolName, String(summary || "").slice(0, 500), ok ? 1 : 0);
}

module.exports = {
  TOKEN_PREFIX,
  parseScopes,
  createApiToken,
  listApiTokens,
  revokeApiToken,
  resolveBearerToken,
  hasScope,
  listMcpAudit,
  logMcpCall,
};
