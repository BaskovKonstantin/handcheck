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
  ensureColumn(db, "users", "is_test", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "birth_date", "TEXT");
  ensureColumn(db, "api_tokens", "client_where", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "api_tokens", "logging_consent_at", "TEXT");
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
  ensureColumn(db, "attempts", "late_answer_text", "TEXT");
  ensureColumn(db, "attempts", "timed_out", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "attempts", "integrity_metrics_json", "TEXT");
  ensureColumn(db, "api_tokens", "privacy_policy_version", "TEXT");
  ensureColumn(db, "calls", "recording_consent_policy_version", "TEXT");
  ensureColumn(db, "batteries", "assessment_consent_at", "TEXT");
  ensureColumn(db, "batteries", "privacy_policy_version", "TEXT");
  const { applyBatteryContentPatch } = require("./task-battery-content");
  applyBatteryContentPatch(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_client_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      api_token_id TEXT REFERENCES api_tokens(id) ON DELETE SET NULL,
      client_name TEXT NOT NULL DEFAULT '',
      client_version TEXT NOT NULL DEFAULT '',
      protocol_version TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      ip_hash TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_sessions_user ON mcp_client_sessions(user_id, last_seen_at DESC);
    CREATE TABLE IF NOT EXISTS mcp_tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES mcp_client_sessions(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      api_token_id TEXT REFERENCES api_tokens(id) ON DELETE SET NULL,
      tool_name TEXT NOT NULL,
      args_masked_json TEXT NOT NULL DEFAULT '{}',
      intent_text TEXT,
      ok INTEGER NOT NULL,
      error_code TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_user ON mcp_tool_calls(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS data_processing_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      context TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      consented_at TEXT NOT NULL,
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_data_consents_user ON data_processing_consents(user_id, consented_at DESC);
  `);

  const { shouldMarkUserAsTest } = require("../lib/is-test-user");
  const users = db.prepare("SELECT id, email FROM users").all();
  const prof = db.prepare("SELECT display_name FROM candidate_profiles WHERE user_id = ?");
  const mark = db.prepare("UPDATE users SET is_test = 1 WHERE id = ? AND is_test = 0");
  for (const u of users) {
    const dn = prof.get(u.id)?.display_name;
    if (shouldMarkUserAsTest(u.email, dn)) mark.run(u.id);
  }

  db.exec(`
    UPDATE candidate_profiles
    SET display_name = ''
    WHERE display_name != ''
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = candidate_profiles.user_id
          AND lower(trim(candidate_profiles.display_name)) = lower(trim(substr(u.email, 1, instr(u.email, '@') - 1)))
      );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS employer_tests (
      id TEXT PRIMARY KEY,
      employer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      need_id TEXT NOT NULL REFERENCES employer_needs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_employer_tests_owner ON employer_tests(employer_user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_employer_tests_need ON employer_tests(need_id, status);

    CREATE TABLE IF NOT EXISTS employer_test_items (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES employer_tests(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('text', 'single', 'multi', 'code')),
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      answer_key_json TEXT NOT NULL DEFAULT '{}',
      rubric_keys_json TEXT NOT NULL DEFAULT '{}',
      time_limit_sec INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_employer_test_items_test ON employer_test_items(test_id, position);

    CREATE TABLE IF NOT EXISTS employer_test_assignments (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES employer_tests(id) ON DELETE CASCADE,
      candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitation_id TEXT REFERENCES invitations(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'started', 'submitted', 'expired')),
      due_at TEXT NOT NULL,
      started_at TEXT,
      submitted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_employer_test_assignments_candidate ON employer_test_assignments(candidate_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_employer_test_assignments_test ON employer_test_assignments(test_id);

    CREATE TABLE IF NOT EXISTS employer_test_answers (
      assignment_id TEXT NOT NULL REFERENCES employer_test_assignments(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES employer_test_items(id) ON DELETE CASCADE,
      answer_text TEXT NOT NULL DEFAULT '',
      choice_json TEXT NOT NULL DEFAULT '[]',
      auto_ok INTEGER,
      paste_chars INTEGER NOT NULL DEFAULT 0,
      typed_chars INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      submitted_at TEXT,
      PRIMARY KEY (assignment_id, item_id)
    );
  `);

  ensureColumn(db, "employer_test_assignments", "current_item_id", "TEXT");
  ensureColumn(db, "employer_test_answers", "opened_at", "TEXT");
  ensureColumn(db, "employer_test_answers", "timed_out", "INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    UPDATE employer_test_assignments AS a
    SET invitation_id = (
      SELECT i.id FROM invitations i
      INNER JOIN employer_tests t ON t.id = a.test_id
      WHERE i.employer_user_id = t.employer_user_id
        AND i.candidate_user_id = a.candidate_user_id
        AND i.need_id = t.need_id
        AND i.status = 'accepted'
      ORDER BY i.created_at DESC
      LIMIT 1
    )
    WHERE a.invitation_id IS NULL
      AND EXISTS (
        SELECT 1 FROM invitations i
        INNER JOIN employer_tests t ON t.id = a.test_id
        WHERE i.employer_user_id = t.employer_user_id
          AND i.candidate_user_id = a.candidate_user_id
          AND i.need_id = t.need_id
          AND i.status = 'accepted'
      );
  `);
}

module.exports = { applyPatches };
