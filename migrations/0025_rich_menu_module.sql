CREATE TABLE IF NOT EXISTS line_channel_settings (
  id TEXT PRIMARY KEY,
  token_ciphertext TEXT NOT NULL DEFAULT '',
  token_iv TEXT NOT NULL DEFAULT '',
  token_last4 TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rich_menus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  alias_id TEXT NOT NULL DEFAULT '',
  chat_bar_text TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  image_data_url TEXT NOT NULL DEFAULT '',
  line_rich_menu_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'updated', 'deployed')),
  deployed_at TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT REFERENCES platform_users(id),
  updated_by_user_id TEXT REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rich_menus_updated_at ON rich_menus(updated_at DESC);
