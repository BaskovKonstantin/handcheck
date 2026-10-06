"use strict";

const crypto = require("crypto");

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function randomSixDigit() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = { hashCode, randomSixDigit };
