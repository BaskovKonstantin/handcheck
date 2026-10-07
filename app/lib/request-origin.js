"use strict";

const { isRequestSecure } = require("./request-secure");

/** Browser Origin header value for this request (Host / X-Forwarded-Host + scheme). */
function getRequestOrigin(req) {
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || "";
  const host = String(hostHeader).split(",")[0].trim();
  if (!host) return "";
  const proto = isRequestSecure(req) ? "https" : "http";
  return `${proto}://${host}`;
}

module.exports = { getRequestOrigin };
