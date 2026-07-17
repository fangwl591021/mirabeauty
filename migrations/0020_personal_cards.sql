CREATE TABLE IF NOT EXISTS personal_cards (
  id TEXT PRIMARY KEY,
  platform_user_id TEXT NOT NULL UNIQUE REFERENCES platform_users(id),
  display_name TEXT NOT NULL DEFAULT '',
  english_name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  company_phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  line_url TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  buttons_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_personal_cards_status ON personal_cards(status, updated_at DESC);
