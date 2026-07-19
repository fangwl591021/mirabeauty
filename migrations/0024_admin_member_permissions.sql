CREATE TABLE IF NOT EXISTS admin_member_permissions (
  platform_user_id TEXT PRIMARY KEY REFERENCES platform_users(id),
  system_access INTEGER NOT NULL DEFAULT 0 CHECK (system_access IN (0, 1)),
  operator_access INTEGER NOT NULL DEFAULT 0 CHECK (operator_access IN (0, 1)),
  granted_by_user_id TEXT REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_member_permissions_access
  ON admin_member_permissions(system_access, operator_access);
