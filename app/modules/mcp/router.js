"use strict";

const express = require("express");
const { requireApiTokenAuth } = require("../../middleware/auth");
const { mcpRateLimit } = require("../../middleware/mcp-rate-limit");
const { httpError } = require("../../middleware/errors");
const { createMcpServerForContext } = require("./register-server");
const { recordInitialize, upsertClientSession } = require("../../lib/mcp-telemetry");

const router = express.Router();

router.get("/", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Метод не поддерживается" },
    id: null,
  });
});

router.use(requireApiTokenAuth, mcpRateLimit);

async function handleMcpPost(req, res) {
  const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const ctx = {
    user: req.user,
    tokenId: req.apiToken.id,
    tokenName: req.apiToken.name,
    scopesJson: req.apiToken.scopes_json,
  };
  const body = req.body;
  if (body?.method === "initialize" && body.params) {
    recordInitialize(ctx, req, body.params);
  } else {
    ctx.mcpSessionId = upsertClientSession(ctx, {
      clientName: req.headers["mcp-client-name"] || "http",
      clientVersion: req.headers["mcp-client-version"] || "",
      userAgent: req.headers["user-agent"],
      ip: req.ip || req.socket?.remoteAddress,
    });
  }
  const server = createMcpServerForContext(ctx);
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (_e) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Внутренняя ошибка MCP" },
        id: null,
      });
    }
  }
}

router.post("/", handleMcpPost);
router.post("", handleMcpPost);

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status === 429) {
    return res.status(429).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Слишком много запросов — подождите минуту" },
      id: null,
    });
  }
  next(err);
});

module.exports = router;
