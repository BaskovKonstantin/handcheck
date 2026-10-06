"use strict";

const { getDb } = require("../db");
const config = require("../config");
const { httpError } = require("./errors");
const { isRequestSecure } = require("../lib/request-secure");

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

function attachUser(req, _res, next) {
  req.session = loadSession(req);
  req.user = req.session
    ? {
        id: req.session.user_id,
        email: req.session.email,
        role: req.session.role,
        email_confirmed_at: req.session.email_confirmed_at,
      }
    : null;
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(httpError(401, "unauthorized"));
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
  requireConfirmedEmail,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  loadSession,
  isRequestSecure,
};
