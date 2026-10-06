"use strict";

const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { buildMcpServer } = require("./register");
const { httpError } = require("../../middleware/errors");

const RATE_LIMIT = Number(process.env.MCP_RATE_LIMIT_PER_MIN || 120);
const buckets = new Map();

function rateLimitKey(tokenId) {
  return tokenId || "anon";
}

function checkRateLimit(tokenId) {
  const key = rateLimitKey(tokenId);
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > 60000) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > RATE_LIMIT) {
    throw httpError(429, "rate_limited");
  }
}

function requireMcpAuth(req, res, next) {
  if (!req.user || !req.apiToken) {
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Нужен Bearer-токен hc_… в заголовке Authorization" },
      id: null,
    });
  }
  try {
    checkRateLimit(req.apiToken.id);
    next();
  } catch (e) {
    res.status(429).json({
      jsonrpc: "2.0",
      error: { code: -32029, message: "Слишком много запросов MCP — подождите минуту" },
      id: null,
    });
  }
}

function attachMcpRoutes(app) {
  app.post("/mcp", requireMcpAuth, async (req, res) => {
    const ctx = {
      user: req.user,
      scopes: req.apiToken.scopes,
      tokenId: req.apiToken.id,
    };
    const server = buildMcpServer(ctx);
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
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Внутренняя ошибка MCP" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });
}

module.exports = { attachMcpRoutes, checkRateLimit };
