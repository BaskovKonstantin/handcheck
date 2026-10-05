"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { hashCode, randomSixDigit } = require("../../lib/tokens");
const config = require("../../config");
const {
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
} = require("../../middleware/auth");
const { httpError } = require("../../middleware/errors");

const router = express.Router();

router.post("/register", (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "").trim();
    if (!email || !password || !["candidate", "employer"].includes(role)) {
      throw httpError(400, "invalid_body");
    }
    const db = getDb();
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) throw httpError(409, "email_taken");
    const id = newId();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      "INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)"
    ).run(id, email, hash, role);
    if (role === "candidate") {
      db.prepare(
        "INSERT INTO candidate_profiles (user_id, display_name, contact_email) VALUES (?, ?, ?)"
      ).run(id, email.split("@")[0], email);
    } else {
      db.prepare(
        "INSERT INTO employer_profiles (user_id, company_name, contact_email) VALUES (?, ?, ?)"
      ).run(id, "", email);
    }
    const code = randomSixDigit();
    db.prepare(
      `INSERT INTO email_tokens (id, user_id, code_hash, purpose, expires_at)
       VALUES (?, ?, ?, 'confirm', datetime('now', '+1 day'))`
    ).run(newId(), id, hashCode(code));
    res.status(201).json({ ok: true, email });
  } catch (e) {
    next(e);
  }
});

router.post("/confirm", (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    const db = getDb();
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (!user) throw httpError(400, "invalid_code");
    const token = db
      .prepare(
        `SELECT id, code_hash FROM email_tokens
         WHERE user_id = ? AND purpose = 'confirm' AND used_at IS NULL
         ORDER BY expires_at DESC LIMIT 1`
      )
      .get(user.id);
    const demoOk = config.DEMO_MODE && code === "000000";
    const ok = token && (demoOk || hashCode(code) === token.code_hash);
    if (!ok) throw httpError(400, "invalid_code");
    const now = new Date().toISOString();
    db.prepare("UPDATE users SET email_confirmed_at = ? WHERE id = ?").run(now, user.id);
    if (token) db.prepare("UPDATE email_tokens SET used_at = ? WHERE id = ?").run(now, token.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/login", (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw httpError(401, "invalid_credentials");
    }
    const sid = newId();
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(
      sid,
      user.id,
      expires
    );
    setSessionCookie(res, sid);
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        email_confirmed_at: user.email_confirmed_at,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post("/logout", requireAuth, (req, res) => {
  const db = getDb();
  if (req.session?.id) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(req.session.id);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
