-- One-time, idempotent repair for members that existed before point events
-- were emitted at login/profile completion.  This deliberately writes the
-- same idempotency keys as the runtime so future reconciliation is safe.

-- Every active member needs a point account before a historical event can be
-- recorded.  Existing accounts are never replaced.
INSERT OR IGNORE INTO point_accounts (id, platform_user_id, program_id, balance)
SELECT 'pointacct_backfill_' || pu.id, pu.id, 'program_main', 0
FROM platform_users pu
WHERE pu.status = 'active';

-- 1. Joined member: once per active member.
INSERT INTO point_ledger_entries
  (id, point_account_id, platform_user_id, program_id, point_rule_id, event_type, event_reference, idempotency_key, delta, balance_after, metadata_json)
SELECT
  'ledger_backfill_member_' || pu.id,
  pa.id,
  pu.id,
  'program_main',
  rule.id,
  'member_joined',
  pu.id,
  'member_joined:' || pu.id,
  rule.points,
  pa.balance + rule.points,
  '{"backfill":true}'
FROM platform_users pu
JOIN point_accounts pa ON pa.platform_user_id = pu.id AND pa.program_id = 'program_main'
JOIN point_rules rule ON rule.id = (
  SELECT id FROM point_rules
  WHERE program_id = 'program_main' AND event_type = 'member_joined' AND status = 'active'
  ORDER BY created_at DESC LIMIT 1
)
WHERE pu.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM point_ledger_entries le
    WHERE le.idempotency_key = 'member_joined:' || pu.id
  );

UPDATE point_accounts
SET balance = balance + COALESCE((
  SELECT SUM(le.delta) FROM point_ledger_entries le
  WHERE le.point_account_id = point_accounts.id
    AND le.id LIKE 'ledger_backfill_member_%'
), 0), updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT point_account_id FROM point_ledger_entries WHERE id LIKE 'ledger_backfill_member_%');

-- 2. Completed registration: once per completed member.
INSERT INTO point_ledger_entries
  (id, point_account_id, platform_user_id, program_id, point_rule_id, event_type, event_reference, idempotency_key, delta, balance_after, metadata_json)
SELECT
  'ledger_backfill_registration_' || mp.platform_user_id,
  pa.id,
  mp.platform_user_id,
  'program_main',
  rule.id,
  'registration_completed',
  mp.platform_user_id,
  'registration_completed:' || mp.platform_user_id,
  rule.points,
  pa.balance + rule.points,
  '{"backfill":true}'
FROM member_profiles mp
JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
JOIN point_accounts pa ON pa.platform_user_id = mp.platform_user_id AND pa.program_id = 'program_main'
JOIN point_rules rule ON rule.id = (
  SELECT id FROM point_rules
  WHERE program_id = 'program_main' AND event_type = 'registration_completed' AND status = 'active'
  ORDER BY created_at DESC LIMIT 1
)
WHERE mp.profile_completed_at IS NOT NULL AND mp.profile_completed_at != ''
  AND NOT EXISTS (
    SELECT 1 FROM point_ledger_entries le
    WHERE le.idempotency_key = 'registration_completed:' || mp.platform_user_id
  );

UPDATE point_accounts
SET balance = balance + COALESCE((
  SELECT SUM(le.delta) FROM point_ledger_entries le
  WHERE le.point_account_id = point_accounts.id
    AND le.id LIKE 'ledger_backfill_registration_%'
), 0), updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT point_account_id FROM point_ledger_entries WHERE id LIKE 'ledger_backfill_registration_%');

-- 3. Successful invitation: one award to the introducer for every active
-- referral relationship.  Windowing keeps balance_after correct for members
-- who introduced more than one person.
INSERT INTO point_ledger_entries
  (id, point_account_id, platform_user_id, program_id, point_rule_id, event_type, event_reference, idempotency_key, delta, balance_after, metadata_json)
SELECT
  'ledger_backfill_referral_' || referred_user_id,
  point_account_id,
  referrer_user_id,
  'program_main',
  point_rule_id,
  'share_referral',
  referred_user_id,
  'share_referral:' || referred_user_id,
  points,
  initial_balance + SUM(points) OVER (PARTITION BY referrer_user_id ORDER BY referred_user_id),
  '{"backfill":true}'
FROM (
  SELECT
    rr.referred_user_id,
    rr.referrer_user_id,
    pa.id AS point_account_id,
    pa.balance AS initial_balance,
    rule.id AS point_rule_id,
    rule.points AS points
  FROM referral_relationships rr
  JOIN platform_users referrer ON referrer.id = rr.referrer_user_id AND referrer.status = 'active'
  JOIN point_accounts pa ON pa.platform_user_id = rr.referrer_user_id AND pa.program_id = 'program_main'
  JOIN point_rules rule ON rule.id = (
    SELECT id FROM point_rules
    WHERE program_id = 'program_main' AND event_type = 'share_referral' AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  )
  WHERE rr.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM point_ledger_entries le
      WHERE le.idempotency_key = 'share_referral:' || rr.referred_user_id
    )
);

UPDATE point_accounts
SET balance = balance + COALESCE((
  SELECT SUM(le.delta) FROM point_ledger_entries le
  WHERE le.point_account_id = point_accounts.id
    AND le.id LIKE 'ledger_backfill_referral_%'
), 0), updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT point_account_id FROM point_ledger_entries WHERE id LIKE 'ledger_backfill_referral_%');
