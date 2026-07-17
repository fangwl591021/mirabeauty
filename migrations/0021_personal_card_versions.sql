-- Personal card: mirror LINE- three image-version digital card configuration.
ALTER TABLE personal_cards ADD COLUMN selected_version TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE personal_cards ADD COLUMN versions_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS personal_card_media (
  id TEXT PRIMARY KEY,
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_personal_card_media_owner ON personal_card_media(platform_user_id, created_at DESC);
