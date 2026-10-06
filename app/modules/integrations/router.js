"use strict";

const express = require("express");
const config = require("../../config");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { httpError } = require("../../middleware/errors");
const {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  listMcpAudit,
  parseScopes,
} = require("../../lib/api-tokens");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail);

router.get("/config", (req, res) => {
  const base = config.APP_BASE_URL.replace(/\/$/, "");
  res.json({
    mcpUrl: `${base}/mcp`,
    appBaseUrl: base,
  });
});

router.get("/tokens", (req, res) => {
  res.json({ items: listApiTokens(req.user.id) });
});

router.get("/audit", (req, res) => {
  res.json({ items: listMcpAudit(req.user.id, req.query.limit) });
});

router.post("/tokens", (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) throw httpError(400, "invalid_body");
    const scopes = parseScopes(req.body?.scopes);
    const created = createApiToken(req.user.id, name, scopes);
    res.status(201).json({
      id: created.id,
      token: created.token,
      prefix: created.prefix,
      scopes: created.scopes,
      message: "Скопируйте токен сейчас — повторно он не показывается.",
    });
  } catch (e) {
    next(e);
  }
});

router.delete("/tokens/:id", (req, res, next) => {
  const ok = revokeApiToken(req.user.id, req.params.id);
  if (!ok) return next(httpError(404, "not_found"));
  res.json({ ok: true });
});

module.exports = router;
