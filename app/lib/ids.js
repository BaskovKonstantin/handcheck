"use strict";

const { randomUUID } = require("crypto");

function newId() {
  return randomUUID();
}

module.exports = { newId };
