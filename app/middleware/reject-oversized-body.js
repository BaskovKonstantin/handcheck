"use strict";

const { httpError } = require("./errors");

function rejectOversizedBody(maxBytes) {
  return (req, res, next) => {
    const raw = req.headers["content-length"];
    if (raw === undefined || raw === "") return next();
    const len = Number(raw);
    if (!Number.isFinite(len) || len < 0) return next();
    if (len > maxBytes) {
      res.status(413).json({ error: "file_too_large" });
      if (typeof req.destroy === "function") {
        req.destroy();
      } else if (req.socket && typeof req.socket.destroy === "function") {
        req.socket.destroy();
      }
      return;
    }
    next();
  };
}

module.exports = { rejectOversizedBody };
