"use strict";

const INVALID_JSON_BODY_MSG = "Некорректный формат тела запроса";

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

module.exports = { errorHandler, httpError, INVALID_JSON_BODY_MSG };
