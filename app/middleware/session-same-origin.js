"use strict";

const { httpError } = require("./errors");
const { isForbiddenBrowserOrigin } = require("../lib/browser-same-origin");

const SESSION_ORIGIN_FORBIDDEN_MSG =
  "Запрос отклонён: действие доступно только с сайта HandCheck.";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requireSessionSameOrigin(req, _res, next) {
  if (req.authMethod !== "session") return next();
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return next();

  if (isForbiddenBrowserOrigin(req)) {
    return next(
      httpError(403, "forbidden", { message: SESSION_ORIGIN_FORBIDDEN_MSG })
    );
  }

  next();
}

module.exports = { requireSessionSameOrigin, SESSION_ORIGIN_FORBIDDEN_MSG };
