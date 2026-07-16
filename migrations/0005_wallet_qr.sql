CREATE TABLE IF NOT EXISTS wallet_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  purpose TEXT NOT NULL DEFAULT 'member_identification' CHECK (purpose IN ('member_identification', 'attendance', 'redemption')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_wallet_tokens_lookup ON wallet_tokens(token_hash, status, expires_at);

CREATE TABLE IF NOT EXISTS wallet_scan_events (
  id TEXT PRIMARY KEY,
  wallet_token_id TEXT REFERENCES wallet_tokens(id),
  platform_user_id TEXT REFERENCES platform_users(id),
  scanner_label TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL CHECK (result IN ('accepted', 'rejected')),
  reason_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_scan_events_token ON wallet_scan_events(wallet_token_id, created_at DESC);
