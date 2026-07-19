-- A course may have many calendar sessions.  Cover artwork belongs to the
-- individual activity/session so editing one event never changes every session.
ALTER TABLE course_sessions ADD COLUMN cover_url TEXT NOT NULL DEFAULT '';

-- Preserve what members currently see as the starting image for every existing
-- session before later edits become independent.
UPDATE course_sessions
SET cover_url = COALESCE((
  SELECT c.cover_url FROM courses c WHERE c.id = course_sessions.course_id
), '')
WHERE cover_url = '';
