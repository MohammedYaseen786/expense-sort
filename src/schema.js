// SQLite schema. Applied every time the app opens the database (all statements are idempotent).

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT 'Unlabelled account',
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  is_credit INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  source TEXT DEFAULT 'manual',
  import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW},
  updated_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT,
  source TEXT NOT NULL,
  account TEXT,
  records_added INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  currency_symbol TEXT DEFAULT 'R',
  default_account TEXT DEFAULT 'Credit Card',
  default_year INTEGER DEFAULT 2026,
  updated_at TEXT DEFAULT ${NOW}
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_dedupe ON transactions(user_id, date, description, is_credit);
CREATE INDEX IF NOT EXISTS idx_imports_user_id ON imports(user_id);
`

module.exports = { SCHEMA }
