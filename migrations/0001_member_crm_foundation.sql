PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS external_identities (
  id TEXT PRIMARY KEY,
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'verified' CHECK (verification_status IN ('verified', 'revoked', 'conflict')),
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_external_identities_user ON external_identities(platform_user_id);

CREATE TABLE IF NOT EXISTS member_profiles (
  platform_user_id TEXT PRIMARY KEY REFERENCES platform_users(id),
  display_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  profile_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invite_links (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL REFERENCES platform_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'expired')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invite_links_inviter ON invite_links(inviter_user_id, status);

CREATE TABLE IF NOT EXISTS invite_touches (
  id TEXT PRIMARY KEY,
  invite_link_id TEXT NOT NULL REFERENCES invite_links(id),
  touch_token_hash TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'invite_link',
  user_agent_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS referral_relationships (
  id TEXT PRIMARY KEY,
  referred_user_id TEXT NOT NULL UNIQUE REFERENCES platform_users(id),
  referrer_user_id TEXT NOT NULL REFERENCES platform_users(id),
  invite_link_id TEXT REFERENCES invite_links(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  policy_version TEXT NOT NULL DEFAULT 'first-valid-referrer-v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (referred_user_id <> referrer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_relationships_referrer ON referral_relationships(referrer_user_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES platform_users(id),
  subject_user_id TEXT REFERENCES platform_users(id),
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_subject ON audit_logs(subject_user_id, created_at DESC);
