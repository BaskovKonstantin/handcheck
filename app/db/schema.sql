PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('candidate', 'employer')),
  email_confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  stack_json TEXT NOT NULL DEFAULT '[]',
  phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  consent_at TEXT,
  fsp_id TEXT,
  availability TEXT NOT NULL DEFAULT 'open' CHECK (availability IN ('open', 'paused'))
);

CREATE TABLE IF NOT EXISTS employer_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS background_episodes (
  id TEXT PRIMARY KEY,
  candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_title TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  specialization TEXT NOT NULL,
  grade TEXT NOT NULL,
  label TEXT NOT NULL,
  UNIQUE (specialization, grade)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('quick', 'work')),
  specialization TEXT NOT NULL,
  grade TEXT NOT NULL,
  form_key TEXT,
  prompt TEXT NOT NULL,
  rubric_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'llm')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batteries (
  id TEXT PRIMARY KEY,
  candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialization TEXT NOT NULL,
  claimed_grade TEXT NOT NULL,
  form_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  battery_id TEXT NOT NULL REFERENCES batteries(id) ON DELETE CASCADE,
  form_key TEXT NOT NULL,
  answer_text TEXT NOT NULL DEFAULT '',
  knowledge REAL,
  breadth REAL,
  opened_at TEXT,
  started_at TEXT,
  submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS attempt_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidate_categories (
  candidate_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  specialization TEXT NOT NULL,
  grade TEXT NOT NULL,
  test_score REAL NOT NULL,
  knowledge REAL NOT NULL,
  breadth REAL NOT NULL,
  motivation REAL NOT NULL DEFAULT 0,
  assigned_at TEXT NOT NULL,
  grade_changed_at TEXT
);

CREATE TABLE IF NOT EXISTS candidate_private (
  candidate_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  integrity REAL NOT NULL DEFAULT 0,
  trust_ok INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fsp_achievements (
  id TEXT PRIMARY KEY,
  candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  earned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employer_needs (
  id TEXT PRIMARY KEY,
  employer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  specialization TEXT NOT NULL,
  grade TEXT NOT NULL,
  stack_json TEXT NOT NULL DEFAULT '[]',
  domain_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS need_reviews (
  id TEXT PRIMARY KEY,
  employer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  need_id TEXT NOT NULL REFERENCES employer_needs(id) ON DELETE CASCADE,
  candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('rejected', 'later', 'invited')),
  updated_at TEXT NOT NULL,
  UNIQUE (employer_user_id, need_id, candidate_user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  employer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  need_id TEXT NOT NULL REFERENCES employer_needs(id),
  candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  salary_from INTEGER NOT NULL,
  salary_to INTEGER NOT NULL,
  offer_text TEXT NOT NULL,
  contact_channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'viewed', 'accepted', 'declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL UNIQUE REFERENCES invitations(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ready', 'live', 'ended')),
  started_at TEXT,
  ended_at TEXT,
  recording_path TEXT,
  transcript_text TEXT NOT NULL DEFAULT '',
  consent_at_candidate TEXT,
  consent_at_employer TEXT
);

CREATE TABLE IF NOT EXISTS call_analyses (
  call_id TEXT PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  domain_hits_json TEXT NOT NULL DEFAULT '[]',
  consistency_note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_attempts_battery ON attempts(battery_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_candidate ON invitations(candidate_user_id);
