"use strict";

const { httpError } = require("./errors");
const { getRequestOrigin } = require("../lib/request-origin");

const SESSION_ORIGIN_FORBIDDEN_MSG =
  "Запрос отклонён: действие доступно только с сайта HandCheck.";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requireSessionSameOrigin(req, _res, next) {
  if (req.authMethod !== "session") return next();
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return next();

  const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (secFetchSite === "cross-site" || secFetchSite === "same-site") {
    return next(
      httpError(403, "forbidden", { message: SESSION_ORIGIN_FORBIDDEN_MSG })
    );
  }

  const origin = req.headers.origin;
  if (origin) {
    const expected = getRequestOrigin(req);
    if (expected && origin !== expected) {
      return next(
        httpError(403, "forbidden", { message: SESSION_ORIGIN_FORBIDDEN_MSG })
      );
    }
  }

  next();
}

module.exports = { requireSessionSameOrigin, SESSION_ORIGIN_FORBIDDEN_MSG };
