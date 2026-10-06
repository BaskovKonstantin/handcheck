"use strict";

const { getDb } = require("../db");
const config = require("../config");
const { httpError } = require("./errors");
const { isRequestSecure } = require("../lib/request-secure");
const { hashToken, parseBearerAuthorization } = require("../lib/api-token");

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

function loadSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies[config.COOKIE_NAME];
  if (!sid) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, s.user_id, s.expires_at, u.email, u.role, u.email_confirmed_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
    )
    .get(sid);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
    return null;
  }
  return row;
}

function loadUserById(userId) {
  const db = getDb();
  return db
    .prepare("SELECT id, email, role, email_confirmed_at FROM users WHERE id = ?")
    .get(userId);
}

function loadApiToken(rawToken) {
  const db = getDb();
  const hash = hashToken(rawToken);
  const row = db
    .prepare(
      `SELECT t.*, u.email, u.role, u.email_confirmed_at
       FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL`
    )
    .get(hash);
  if (!row) return null;
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return row;
}

function attachUser(req, _res, next) {
  req.session = loadSession(req);
  req.authMethod = null;
  req.apiToken = null;
  if (req.session) {
    req.user = {
      id: req.session.user_id,
      email: req.session.email,
      role: req.session.role,
      email_confirmed_at: req.session.email_confirmed_at,
    };
    req.authMethod = "session";
    return next();
  }
  const bearer = parseBearerAuthorization(req.headers.authorization);
  if (bearer) {
    const tokenRow = loadApiToken(bearer);
    if (tokenRow) {
      req.user = {
        id: tokenRow.user_id,
        email: tokenRow.email,
        role: tokenRow.role,
        email_confirmed_at: tokenRow.email_confirmed_at,
      };
      req.apiToken = {
        id: tokenRow.id,
        scopes_json: tokenRow.scopes_json,
        name: tokenRow.name,
      };
      req.authMethod = "api_token";
    }
  }
  if (!req.user) req.user = null;
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(httpError(401, "unauthorized"));
  next();
}

function requireSessionAuth(req, _res, next) {
  if (!req.user || req.authMethod !== "session") return next(httpError(401, "unauthorized"));
  next();
}

function requireApiTokenAuth(req, _res, next) {
  if (!req.user || req.authMethod !== "api_token") {
    return next(httpError(401, "unauthorized"));
  }
  if (!req.user.email_confirmed_at) return next(httpError(403, "email_not_confirmed"));
  next();
}

function requireConfirmedEmail(req, _res, next) {
  if (!req.user?.email_confirmed_at) return next(httpError(403, "email_not_confirmed"));
  next();
}

function cookieSuffix(req) {
  return isRequestSecure(req) ? "; Secure" : "";
}

function setSessionCookie(res, sessionId, req) {
  res.setHeader(
    "Set-Cookie",
    `${config.COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${cookieSuffix(req)}`
  );
}

function clearSessionCookie(res, req) {
  res.setHeader(
    "Set-Cookie",
    `${config.COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSuffix(req)}`
  );
}

module.exports = {
  attachUser,
  requireAuth,
  requireSessionAuth,
  requireApiTokenAuth,
  requireConfirmedEmail,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  loadSession,
  loadUserById,
  isRequestSecure,
};
