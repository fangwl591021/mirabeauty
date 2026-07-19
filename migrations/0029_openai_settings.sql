CREATE TABLE IF NOT EXISTS openai_api_settings (
  id TEXT PRIMARY KEY,
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  api_key_iv TEXT NOT NULL DEFAULT '',
  api_key_last4 TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
