CREATE TABLE IF NOT EXISTS card_import_events (
  id TEXT PRIMARY KEY,
  scanner_user_id TEXT NOT NULL,
  front_r2_key TEXT NOT NULL,
  back_r2_key TEXT NOT NULL DEFAULT '',
  front_content_type TEXT NOT NULL DEFAULT 'image/webp',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','review_ready','created','updated','rejected','failed')),
  ocr_json TEXT NOT NULL DEFAULT '{}',
  contact_card_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scanner_user_id) REFERENCES platform_users(id)
);

CREATE INDEX IF NOT EXISTS idx_card_import_events_owner_created
  ON card_import_events(scanner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_cards (
  id TEXT PRIMARY KEY,
  scanner_user_id TEXT NOT NULL,
  source_event_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'private_import' CHECK (source_type IN ('private_import','public_card')),
  source_personal_card_id TEXT,
  bound_user_id TEXT,
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
  note TEXT NOT NULL DEFAULT '',
  normalized_mobile TEXT NOT NULL DEFAULT '',
  normalized_email TEXT NOT NULL DEFAULT '',
  normalized_name_company TEXT NOT NULL DEFAULT '',
  front_r2_key TEXT NOT NULL DEFAULT '',
  front_content_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scanner_user_id) REFERENCES platform_users(id),
  FOREIGN KEY (source_event_id) REFERENCES card_import_events(id),
  FOREIGN KEY (source_personal_card_id) REFERENCES personal_cards(id),
  UNIQUE (scanner_user_id, source_personal_card_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_cards_owner_updated
  ON contact_cards(scanner_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_cards_owner_phone
  ON contact_cards(scanner_user_id, normalized_mobile);
CREATE INDEX IF NOT EXISTS idx_contact_cards_owner_email
  ON contact_cards(scanner_user_id, normalized_email);
