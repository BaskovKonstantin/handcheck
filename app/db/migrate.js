"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function migrate(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  const { applyPatches } = require("./patches");
  applyPatches(db);
  return db;
}

module.exports = { migrate };
