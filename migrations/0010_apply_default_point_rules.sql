-- Default operational rules for the LINE Login member CRM.
-- These are safe to re-run through D1 migrations: each event uses version v1.
INSERT OR IGNORE INTO point_rules
  (id, program_id, event_type, points, daily_limit, award_frequency, status, rule_version)
VALUES
  ('pointrule_default_member_joined', 'program_main', 'member_joined', 10, NULL, 'once', 'active', 'v1'),
  ('pointrule_default_registration_completed', 'program_main', 'registration_completed', 10, NULL, 'once', 'active', 'v1'),
  ('pointrule_default_daily_ad_checkin', 'program_main', 'daily_ad_checkin', 1, NULL, 'daily', 'active', 'v1');

-- Align any already-created rules to the agreed operating policy.
UPDATE point_rules
SET points = 10, award_frequency = 'once', status = 'active', updated_at = CURRENT_TIMESTAMP
WHERE event_type IN ('member_joined', 'registration_completed');

UPDATE point_rules
SET points = 1, award_frequency = 'daily', status = 'active', updated_at = CURRENT_TIMESTAMP
WHERE event_type = 'daily_ad_checkin';

-- Viewing a card is only a qualification step; it never awards points directly.
UPDATE point_rules
SET points = 0, status = 'paused', updated_at = CURRENT_TIMESTAMP
WHERE event_type IN ('daily_ad_view', 'daily_ad_view_completed', 'daily_view');
