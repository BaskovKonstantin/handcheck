"use strict";

const { migrate } = require("./migrate");
const config = require("../config");

let db;

function getDb() {
  if (!db) {
    db = migrate(config.DB_PATH);
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, migrate };
