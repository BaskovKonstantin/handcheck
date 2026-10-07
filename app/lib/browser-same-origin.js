"use strict";

const { getRequestOrigin } = require("./request-origin");

/** Reject cross-site / sibling-site fetches and foreign Origin (when Origin is sent). */
function isForbiddenBrowserOrigin(req) {
  const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (secFetchSite === "cross-site" || secFetchSite === "same-site") {
    return true;
  }

  const origin = req.headers.origin;
  if (origin) {
    const expected = getRequestOrigin(req);
    if (expected && origin !== expected) {
      return true;
    }
  }

  return false;
}

module.exports = { isForbiddenBrowserOrigin };
