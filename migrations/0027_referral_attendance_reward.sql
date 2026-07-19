-- A direct referrer earns one point whenever a referred member has both
-- registered for and checked in to a course/activity. Runtime awards remain
-- one ledger row per referred member and session for audit and idempotency.
INSERT OR IGNORE INTO point_rules
  (id, program_id, event_type, points, daily_limit, award_frequency, status, rule_version)
VALUES
  ('pointrule_default_referral_attendance_reward', 'program_main', 'referral_attendance_reward', 1, NULL, 'per_completion', 'active', 'v1');
