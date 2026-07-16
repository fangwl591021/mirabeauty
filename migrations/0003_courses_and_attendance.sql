CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by_user_id TEXT REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status, created_at DESC);

CREATE TABLE IF NOT EXISTS course_sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL DEFAULT '',
  attendance_mode TEXT NOT NULL CHECK (attendance_mode IN ('physical', 'online')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  venue_name TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  meeting_url TEXT NOT NULL DEFAULT '',
  checkin_opens_at TEXT NOT NULL,
  checkin_closes_at TEXT NOT NULL,
  checkin_code_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at >= starts_at),
  CHECK (checkin_closes_at >= checkin_opens_at)
);

CREATE INDEX IF NOT EXISTS idx_course_sessions_course ON course_sessions(course_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_course_sessions_status ON course_sessions(status, starts_at);

CREATE TABLE IF NOT EXISTS course_registrations (
  id TEXT PRIMARY KEY,
  course_session_id TEXT NOT NULL REFERENCES course_sessions(id),
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled')),
  registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT,
  UNIQUE(course_session_id, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_course_registrations_user ON course_registrations(platform_user_id, registered_at DESC);

CREATE TABLE IF NOT EXISTS attendance_attempts (
  id TEXT PRIMARY KEY,
  course_session_id TEXT NOT NULL REFERENCES course_sessions(id),
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  method TEXT NOT NULL CHECK (method IN ('physical_qr', 'physical_code', 'online_keyword', 'admin')),
  result TEXT NOT NULL CHECK (result IN ('accepted', 'rejected')),
  reason_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attendance_attempts_session ON attendance_attempts(course_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  course_session_id TEXT NOT NULL REFERENCES course_sessions(id),
  platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
  registration_id TEXT NOT NULL REFERENCES course_registrations(id),
  method TEXT NOT NULL CHECK (method IN ('physical_qr', 'physical_code', 'online_keyword', 'admin')),
  checked_in_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'reversed')),
  reversed_at TEXT,
  reversal_reason TEXT NOT NULL DEFAULT '',
  UNIQUE(course_session_id, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_user ON attendance_records(platform_user_id, checked_in_at DESC);
