"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const {
  generateTokenMaterial,
  hashToken,
  normalizeScopes,
} = require("../../lib/api-token");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { httpError } = require("../../middleware/errors");
const config = require("../../config");
const { dbDateToIso } = require("../../lib/db-datetime");

const router = express.Router();

router.use((req, _res, next) => {
  if (req.authMethod === "api_token") return next(httpError(403, "forbidden"));
  next();
});
router.use(requireAuth, requireConfirmedEmail);

router.get("/tokens", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, name, token_prefix, scopes_json, created_at, last_used_at, revoked_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(req.user.id);
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.token_prefix,
      scopes: JSON.parse(r.scopes_json || "[]"),
      createdAt: dbDateToIso(r.created_at),
      lastUsedAt: dbDateToIso(r.last_used_at),
      revoked: Boolean(r.revoked_at),
    })),
  });
});

router.post("/tokens", (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name || name.length > 80) throw httpError(400, "invalid_body");
    const scopes = normalizeScopes(req.body?.scopes);
    const { raw, hash, displayPrefix } = generateTokenMaterial();
    const id = newId();
    getDb()
      .prepare(
        `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, req.user.id, name, hash, displayPrefix, JSON.stringify(scopes));
    res.status(201).json({
      id,
      token: raw,
      prefix: displayPrefix,
      scopes,
    });
  } catch (e) {
    next(e);
  }
});

router.delete("/tokens/:id", (req, res, next) => {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM api_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(req.params.id, req.user.id);
  if (!row) return next(httpError(404, "not_found"));
  db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

router.get("/audit", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = getDb()
    .prepare(
      `SELECT tool_name, ok, result_summary, created_at
       FROM mcp_audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(req.user.id, limit);
  res.json({
    items: rows.map((r) => ({
      tool: r.tool_name,
      ok: Boolean(r.ok),
      summary: r.result_summary,
      at: dbDateToIso(r.created_at),
    })),
  });
});

router.get("/config", (req, res) => {
  const base = config.APP_BASE_URL.replace(/\/$/, "");
  res.json({
    mcpUrl: `${base}/mcp`,
    cursorSnippet: {
      mcpServers: {
        handcheck: {
          url: `${base}/mcp`,
          headers: {
            Authorization: "Bearer hc_ВАШ_ТОКЕН",
          },
        },
      },
    },
    claudeDesktopSnippet: `${base}/mcp`,
    claudeCodeCommand: `claude mcp add --transport http handcheck ${base}/mcp --header "Authorization: Bearer hc_ВАШ_ТОКЕН"`,
  });
});

module.exports = router;
