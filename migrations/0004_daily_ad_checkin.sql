CREATE TABLE IF NOT EXISTS ad_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  required_creative_count INTEGER NOT NULL DEFAULT 1 CHECK (required_creative_count > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_active ON ad_campaigns(status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS ad_creatives (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),
  creative_type TEXT NOT NULL CHECK (creative_type IN ('image', 'video', 'article')),
  title TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL,
  preview_url TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL DEFAULT '',
  required_watch_seconds INTEGER NOT NULL DEFAULT 3 CHECK (required_watch_seconds >= 0),
  required_completion_ratio REAL NOT NULL DEFAULT 0 CHECK (required_completion_ratio >= 0 AND required_completion_ratio <= 1),
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_campaign ON ad_creatives(campaign_id, status, display_order);

CREATE TABLE IF NOT EXISTS ad_view_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),
  creative_id TEXT NOT NULL REFERENCES ad_creatives(id),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  observed_seconds INTEGER NOT NULL DEFAULT 0,
  completion_ratio REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'qualified', 'expired')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_view_sessions_token ON ad_view_sessions(token_hash, platform_user_id);

CREATE TABLE IF NOT EXISTS daily_ad_view_events (
  id TEXT PRIMARY KEY,
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),
  creative_id TEXT NOT NULL REFERENCES ad_creatives(id),
  business_date TEXT NOT NULL,
  view_session_id TEXT NOT NULL REFERENCES ad_view_sessions(id),
  observed_seconds INTEGER NOT NULL DEFAULT 0,
  completion_ratio REAL NOT NULL DEFAULT 0,
  qualified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform_user_id, campaign_id, creative_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_ad_views_checkin ON daily_ad_view_events(platform_user_id, campaign_id, business_date, qualified_at);

CREATE TABLE IF NOT EXISTS daily_checkins (
  id TEXT PRIMARY KEY,
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),
  business_date TEXT NOT NULL,
  checked_in_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'reversed')),
  reversed_at TEXT,
  reversal_reason TEXT NOT NULL DEFAULT '',
  UNIQUE(platform_user_id, campaign_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_user ON daily_checkins(platform_user_id, business_date DESC);
