"use strict";

function isRequestSecure(req) {
  if (!req) return false;
  if (req.secure === true) return true;
  const proto = req.headers["x-forwarded-proto"];
  if (!proto) return false;
  const first = String(proto).split(",")[0].trim().toLowerCase();
  return first === "https";
}

module.exports = { isRequestSecure };
