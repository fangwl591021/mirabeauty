-- A successful invitation creates a referral relationship at LINE Login.
-- The referrer receives this reward once for each referred member.
-- Existing custom rules are deliberately preserved; this only seeds a missing rule.
INSERT OR IGNORE INTO point_rules
  (id, program_id, event_type, points, daily_limit, award_frequency, status, rule_version)
VALUES
  ('pointrule_default_share_referral', 'program_main', 'share_referral', 10, NULL, 'per_completion', 'active', 'v1');

-- Earlier installations could contain a dormant placeholder for this event.
-- Make the agreed referral rule operational so the backfill can also repair
-- existing inviter relationships.
UPDATE point_rules
SET points = 10, award_frequency = 'per_completion', status = 'active', updated_at = CURRENT_TIMESTAMP
WHERE program_id = 'program_main' AND event_type = 'share_referral';
