CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL DEFAULT 'video' CHECK (asset_type IN ('video')),
  r2_key TEXT NOT NULL UNIQUE,
  poster_r2_key TEXT NOT NULL DEFAULT '',
  original_name TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'video/mp4',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading', 'ready', 'deleting', 'deleted', 'failed')),
  created_by_user_id TEXT REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS media_asset_references (
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (asset_id, template_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_media_assets_status_created ON media_assets(status, created_at);
CREATE INDEX IF NOT EXISTS idx_media_asset_refs_template ON media_asset_references(template_id, page_id);
