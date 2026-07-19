import { newId } from './member-repository.js';

const MAIN_PROGRAM_ID = 'program_main';

export async function getWallet(db, userId) {
  const account = await db.prepare(`
    SELECT pa.id, pa.balance, pp.code AS program_code, pp.name AS program_name
    FROM point_accounts pa JOIN point_programs pp ON pp.id = pa.program_id
    WHERE pa.platform_user_id = ? AND pa.program_id = ?
  `).bind(userId, MAIN_PROGRAM_ID).first();
  if (!account) return { balance: 0, programCode: 'main', programName: 'MiraBeauty 點數', entries: [] };
  const result = await db.prepare(`
    SELECT event_type, event_reference, delta, balance_after, status, created_at
    FROM point_ledger_entries WHERE point_account_id = ? ORDER BY created_at DESC LIMIT 50
  `).bind(account.id).all();
  return {
    balance: account.balance,
    programCode: account.program_code,
    programName: account.program_name,
    entries: result.results || []
  };
}

export async function awardPoints(db, { userId, eventType, eventReference, idempotencyKey, metadata = {} }) {
  if (!userId || !eventType || !eventReference || !idempotencyKey) throw new Error('Missing point award fields');
  const existing = await db.prepare(`
    SELECT id, delta, balance_after FROM point_ledger_entries WHERE idempotency_key = ?
  `).bind(idempotencyKey).first();
  if (existing) return { awarded: false, duplicate: true, entry: existing };

  const rule = await db.prepare(`
    SELECT id, points, daily_limit, award_frequency FROM point_rules
    WHERE program_id = ? AND event_type = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(MAIN_PROGRAM_ID, eventType).first();
  if (!rule || Number(rule.points) <= 0) return { awarded: false, reason: 'no_active_rule' };

  const frequency = ['once', 'daily', 'per_completion'].includes(rule.award_frequency)
    ? rule.award_frequency
    : 'per_completion';
  if (frequency === 'once') {
    const existingAward = await db.prepare(`
      SELECT id FROM point_ledger_entries
      WHERE platform_user_id = ? AND event_type = ? AND status = 'posted'
      LIMIT 1
    `).bind(userId, eventType).first();
    if (existingAward) return { awarded: false, reason: 'once_only_reached' };
  }

  // 「每日一次」規則未設定 daily_limit 時，預設上限必須是 1；
  // Number(null) 會變成 0，會讓第一筆簽到就被錯判為額度已滿。
  const configuredDailyLimit = Number(rule.daily_limit);
  const hasConfiguredDailyLimit = Number.isFinite(configuredDailyLimit) && configuredDailyLimit > 0;
  if (frequency === 'daily' || hasConfiguredDailyLimit) {
    const dailyLimit = frequency === 'daily'
      ? (hasConfiguredDailyLimit ? configuredDailyLimit : 1)
      : configuredDailyLimit;
    const count = await db.prepare(`
      SELECT COUNT(*) AS count FROM point_ledger_entries
      WHERE platform_user_id = ? AND point_rule_id = ? AND status = 'posted'
        AND date(created_at, '+8 hours') = date('now', '+8 hours')
    `).bind(userId, rule.id).first();
    if (Number(count?.count || 0) >= dailyLimit) return { awarded: false, reason: 'daily_limit_reached' };
  }

  let account = await db.prepare(`
    SELECT id, balance FROM point_accounts WHERE platform_user_id = ? AND program_id = ?
  `).bind(userId, MAIN_PROGRAM_ID).first();
  if (!account) {
    const accountId = newId('pointacct');
    await db.prepare('INSERT OR IGNORE INTO point_accounts (id, platform_user_id, program_id) VALUES (?, ?, ?)')
      .bind(accountId, userId, MAIN_PROGRAM_ID).run();
    account = await db.prepare('SELECT id, balance FROM point_accounts WHERE platform_user_id = ? AND program_id = ?')
      .bind(userId, MAIN_PROGRAM_ID).first();
  }

  const delta = Number(rule.points);
  const balanceAfter = Number(account.balance) + delta;
  const entry = { id: newId('ledger'), delta, balanceAfter };
  try {
    await db.batch([
      db.prepare('UPDATE point_accounts SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(balanceAfter, account.id),
      db.prepare(`
        INSERT INTO point_ledger_entries
        (id, point_account_id, platform_user_id, program_id, point_rule_id, event_type, event_reference, idempotency_key, delta, balance_after, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(entry.id, account.id, userId, MAIN_PROGRAM_ID, rule.id, eventType, eventReference, idempotencyKey, delta, balanceAfter, JSON.stringify(metadata))
    ]);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE constraint failed: point_ledger_entries.idempotency_key')) {
      const duplicate = await db.prepare('SELECT id, delta, balance_after FROM point_ledger_entries WHERE idempotency_key = ?').bind(idempotencyKey).first();
      return { awarded: false, duplicate: true, entry: duplicate };
    }
    throw error;
  }
  return { awarded: true, duplicate: false, entry };
}

export async function adjustPoints(db, { userId, actorUserId, action, points, note = '', requestId }) {
  const amount = Number(points);
  if (!['grant', 'deduct', 'backfill'].includes(action)) throw new Error('Invalid point adjustment action');
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) throw new Error('Points must be an integer between 1 and 1000000');
  const safeRequestId = String(requestId || '').trim().slice(0, 120);
  if (!safeRequestId) throw new Error('requestId is required');
  const idempotencyKey = `admin_points:${safeRequestId}`;
  const existing = await db.prepare('SELECT id, delta, balance_after FROM point_ledger_entries WHERE idempotency_key = ?')
    .bind(idempotencyKey).first();
  if (existing) return { adjusted: false, duplicate: true, entry: existing };

  let account = await db.prepare('SELECT id, balance FROM point_accounts WHERE platform_user_id = ? AND program_id = ?')
    .bind(userId, MAIN_PROGRAM_ID).first();
  if (!account) {
    await db.prepare('INSERT OR IGNORE INTO point_accounts (id, platform_user_id, program_id) VALUES (?, ?, ?)')
      .bind(newId('pointacct'), userId, MAIN_PROGRAM_ID).run();
    account = await db.prepare('SELECT id, balance FROM point_accounts WHERE platform_user_id = ? AND program_id = ?')
      .bind(userId, MAIN_PROGRAM_ID).first();
  }
  const delta = action === 'deduct' ? -amount : amount;
  const balanceAfter = Number(account.balance) + delta;
  if (balanceAfter < 0) throw new Error('Insufficient point balance');
  const eventType = action === 'deduct' ? 'admin_points_deduct' : action === 'backfill' ? 'admin_points_backfill' : 'admin_points_grant';
  const entry = { id: newId('ledger'), delta, balanceAfter };
  const metadata = JSON.stringify({ actorUserId, action, note: String(note || '').trim().slice(0, 500) });
  await db.batch([
    db.prepare('UPDATE point_accounts SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(balanceAfter, account.id),
    db.prepare(`INSERT INTO point_ledger_entries
      (id, point_account_id, platform_user_id, program_id, point_rule_id, event_type, event_reference, idempotency_key, delta, balance_after, metadata_json)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`)
      .bind(entry.id, account.id, userId, MAIN_PROGRAM_ID, eventType, safeRequestId, idempotencyKey, delta, balanceAfter, metadata),
    db.prepare('INSERT INTO audit_logs (id, actor_user_id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, ?, ?)')
      .bind(newId('audit'), actorUserId, userId, `points.${action}`, metadata),
  ]);
  return { adjusted: true, duplicate: false, entry };
}
