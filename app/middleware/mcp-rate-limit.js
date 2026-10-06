"use strict";

const config = require("../config");
const { httpError } = require("./errors");

const windows = new Map();

function resetIfNeeded(entry, now) {
  if (now - entry.startedAt > 60_000) {
    entry.startedAt = now;
    entry.count = 0;
  }
}

function mcpRateLimit(req, _res, next) {
  const tokenId = req.apiToken?.id;
  if (!tokenId) return next();
  const now = Date.now();
  let entry = windows.get(tokenId);
  if (!entry) {
    entry = { startedAt: now, count: 0 };
    windows.set(tokenId, entry);
  }
  resetIfNeeded(entry, now);
  entry.count += 1;
  if (entry.count > config.MCP_RATE_LIMIT_PER_MIN) {
    return next(httpError(429, "rate_limit"));
  }
  next();
}

function _resetMcpRateLimitsForTests() {
  windows.clear();
}

module.exports = { mcpRateLimit, _resetMcpRateLimitsForTests };
