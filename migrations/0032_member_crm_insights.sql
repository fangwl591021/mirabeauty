CREATE TABLE IF NOT EXISTS member_crm_insights (
  platform_user_id TEXT PRIMARY KEY REFERENCES platform_users(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  insights_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_member_crm_insights_status
  ON member_crm_insights(status, updated_at);
