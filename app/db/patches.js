"use strict";

function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function ensureColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function applyPatches(db) {
  ensureColumn(
    db,
    "attempts",
    "action_source",
    "TEXT NOT NULL DEFAULT 'web' CHECK (action_source IN ('web', 'mcp'))"
  );
  ensureColumn(
    db,
    "need_reviews",
    "action_source",
    "TEXT NOT NULL DEFAULT 'web' CHECK (action_source IN ('web', 'mcp'))"
  );
  ensureColumn(
    db,
    "invitations",
    "action_source",
    "TEXT NOT NULL DEFAULT 'web' CHECK (action_source IN ('web', 'mcp'))"
  );
}

module.exports = { applyPatches };
