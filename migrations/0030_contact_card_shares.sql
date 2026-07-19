CREATE TABLE IF NOT EXISTS contact_card_shares (
  id TEXT PRIMARY KEY,
  contact_card_id TEXT NOT NULL REFERENCES contact_cards(id),
  owner_user_id TEXT NOT NULL REFERENCES platform_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT NOT NULL DEFAULT '',
  last_accessed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_contact_card_shares_card_status
  ON contact_card_shares(contact_card_id, owner_user_id, status);
