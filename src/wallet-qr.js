import { sha256 } from './auth.js';
import { newId } from './member-repository.js';
import { getWallet } from './points.js';

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export async function issueWalletToken(db, userId, purpose = 'member_identification') {
  const allowedPurposes = new Set(['member_identification', 'attendance', 'redemption']);
  if (!allowedPurposes.has(purpose)) throw new Error('Invalid wallet QR purpose');
  const token = randomToken();
  await db.prepare(`
    INSERT INTO wallet_tokens (id, token_hash, platform_user_id, purpose, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+60 seconds'))
  `).bind(newId('wallettoken'), await sha256(token), userId, purpose).run();
  return { token, expiresIn: 60, purpose };
}

export async function resolveWalletToken(db, rawToken, scannerLabel = '') {
  const tokenHash = await sha256(String(rawToken || ''));
  const row = await db.prepare(`
    SELECT wt.id AS wallet_token_id, wt.platform_user_id, wt.purpose, pu.status, mp.display_name
    FROM wallet_tokens wt
    JOIN platform_users pu ON pu.id = wt.platform_user_id
    LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
    WHERE wt.token_hash = ? AND wt.status = 'active' AND wt.expires_at >= CURRENT_TIMESTAMP
  `).bind(tokenHash).first();
  if (!row || row.status !== 'active') {
    await db.prepare(`INSERT INTO wallet_scan_events (id, scanner_label, result, reason_code) VALUES (?, ?, 'rejected', ?)`)
      .bind(newId('walletscan'), String(scannerLabel).slice(0, 120), 'invalid_or_expired_token').run();
    return { ok: false, reason: 'invalid_or_expired_token' };
  }
  await db.prepare(`
    INSERT INTO wallet_scan_events (id, wallet_token_id, platform_user_id, scanner_label, result)
    VALUES (?, ?, ?, ?, 'accepted')
  `).bind(newId('walletscan'), row.wallet_token_id, row.platform_user_id, String(scannerLabel).slice(0, 120)).run();
  const wallet = await getWallet(db, row.platform_user_id);
  return {
    ok: true,
    member: { userId: row.platform_user_id, displayName: row.display_name || '' },
    purpose: row.purpose,
    wallet: { balance: wallet.balance, programCode: wallet.programCode }
  };
}
