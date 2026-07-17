-- Only these event types are emitted by the current member CRM runtime.
-- Legacy/free-text rules are retained for audit but must not appear as usable rules.
UPDATE point_rules
SET status = 'paused', updated_at = CURRENT_TIMESTAMP
WHERE status = 'active'
  AND event_type NOT IN (
    'member_joined',
    'registration_completed',
    'daily_ad_checkin',
    'share_referral',
    'course_registered',
    'attendance_verified',
    'task_completed'
  );
