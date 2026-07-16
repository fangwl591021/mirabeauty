CREATE TABLE IF NOT EXISTS point_programs (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO point_programs (id, code, name) VALUES ('program_main', 'main', 'MiraBeauty 點數');

CREATE TABLE IF NOT EXISTS point_rules (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES point_programs(id),
  event_type TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  daily_limit INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  rule_version TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(program_id, event_type, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_point_rules_event ON point_rules(program_id, event_type, status);

CREATE TABLE IF NOT EXISTS point_accounts (
  id TEXT PRIMARY KEY,
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  program_id TEXT NOT NULL REFERENCES point_programs(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform_user_id, program_id)
);

CREATE INDEX IF NOT EXISTS idx_point_accounts_user ON point_accounts(platform_user_id, program_id);

CREATE TABLE IF NOT EXISTS point_ledger_entries (
  id TEXT PRIMARY KEY,
  point_account_id TEXT NOT NULL REFERENCES point_accounts(id),
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  program_id TEXT NOT NULL REFERENCES point_programs(id),
  point_rule_id TEXT REFERENCES point_rules(id),
  event_type TEXT NOT NULL,
  event_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_point_ledger_user ON point_ledger_entries(platform_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_ledger_account ON point_ledger_entries(point_account_id, created_at DESC);
