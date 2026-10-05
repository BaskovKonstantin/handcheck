"use strict";

const { httpError } = require("./errors");

function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user || req.user.role !== role) {
      return next(httpError(403, "forbidden"));
    }
    next();
  };
}

function requireNotCandidate(req, _res, next) {
  if (!req.user) return next(httpError(401, "unauthorized"));
  if (req.user.role === "candidate") return next(httpError(403, "forbidden"));
  next();
}

module.exports = { requireRole, requireNotCandidate };
