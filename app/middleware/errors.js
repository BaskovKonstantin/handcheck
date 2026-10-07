"use strict";

const INVALID_JSON_BODY_MSG = "Некорректный формат тела запроса";
const MCP_INVALID_JSON_MSG = "Некорректный JSON в запросе";
const MCP_PAYLOAD_TOO_LARGE_MSG =
  "Запрос слишком большой. Уменьшите объём данных и повторите.";

function isMcpRequest(req) {
  const p = req.originalUrl || req.url || "";
  return p === "/mcp" || p.startsWith("/mcp?");
}

function sendMcpJsonRpcError(res, httpStatus, code, message) {
  return res.status(httpStatus).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const body = { error: err.code || err.message || "internal_error" };
  if (err.details) body.details = err.details;
  res.status(status).json(body);
}

function httpError(status, code, details) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  e.details = details;
  return e;
}

module.exports = {
  errorHandler,
  httpError,
  INVALID_JSON_BODY_MSG,
  MCP_INVALID_JSON_MSG,
  MCP_PAYLOAD_TOO_LARGE_MSG,
  isMcpRequest,
  sendMcpJsonRpcError,
};
