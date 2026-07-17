ALTER TABLE point_rules ADD COLUMN award_frequency TEXT NOT NULL DEFAULT 'per_completion'
  CHECK (award_frequency IN ('once', 'daily', 'per_completion'));

UPDATE point_rules
SET award_frequency = CASE
  WHEN event_type IN ('member_joined', 'registration_completed') THEN 'once'
  WHEN event_type = 'daily_ad_checkin' THEN 'daily'
  ELSE 'per_completion'
END;
