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
  applyPatches(db);
  return db;
}

function columnExists(db, table, name) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name);
}

function applyPatches(db) {
  if (!columnExists(db, "attempts", "submit_source")) {
    db.exec(`ALTER TABLE attempts ADD COLUMN submit_source TEXT NOT NULL DEFAULT 'web'`);
  }
  if (!columnExists(db, "need_reviews", "source")) {
    db.exec(`ALTER TABLE need_reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'web'`);
  }
  if (!columnExists(db, "invitations", "source")) {
    db.exec(`ALTER TABLE invitations ADD COLUMN source TEXT NOT NULL DEFAULT 'web'`);
  }
}

module.exports = { migrate };
