-- Calendar uses course_sessions as its single source of truth.  The source
-- records how a member enrolled, so QR enrollment and normal enrollment
-- remain visible in CRM without creating a second event-registration table.
ALTER TABLE course_registrations ADD COLUMN source TEXT NOT NULL DEFAULT 'member_portal';

CREATE INDEX IF NOT EXISTS idx_course_sessions_calendar
ON course_sessions(status, starts_at);

CREATE INDEX IF NOT EXISTS idx_course_registrations_source
ON course_registrations(course_session_id, source, registered_at DESC);
