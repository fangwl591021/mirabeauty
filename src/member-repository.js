import { sha256 } from './auth.js';

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function profileFromRow(row) {
  return row && {
    userId: row.user_id,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
    phone: row.phone,
    email: row.email,
    status: row.status
  };
}

export async function resolveLineMember(db, lineProfile, inviteToken = '') {
  const identity = await db.prepare(`
    SELECT ei.platform_user_id AS user_id, pu.status, mp.display_name, mp.picture_url, mp.phone, mp.email
    FROM external_identities ei
    JOIN platform_users pu ON pu.id = ei.platform_user_id
    LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
    WHERE ei.provider = 'line_login' AND ei.provider_subject = ? AND ei.verification_status = 'verified'
  `).bind(lineProfile.sub).first();

  if (identity) {
    await db.prepare('UPDATE external_identities SET last_verified_at = CURRENT_TIMESTAMP WHERE provider = ? AND provider_subject = ?')
      .bind('line_login', lineProfile.sub).run();
    return { member: profileFromRow(identity), created: false, referralCreated: false };
  }

  const userId = newId('usr');
  const identityId = newId('identity');
  const displayName = String(lineProfile.name || '').slice(0, 120);
  const pictureUrl = String(lineProfile.picture || '').slice(0, 2048);
  const email = String(lineProfile.email || '').slice(0, 320);
  const statements = [
    db.prepare('INSERT INTO platform_users (id) VALUES (?)').bind(userId),
    db.prepare('INSERT INTO external_identities (id, platform_user_id, provider, provider_subject) VALUES (?, ?, ?, ?)')
      .bind(identityId, userId, 'line_login', lineProfile.sub),
    db.prepare('INSERT INTO member_profiles (platform_user_id, display_name, picture_url, email) VALUES (?, ?, ?, ?)')
      .bind(userId, displayName, pictureUrl, email),
    db.prepare('INSERT INTO audit_logs (id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, ?)')
      .bind(newId('audit'), userId, 'member.registered', JSON.stringify({ provider: 'line_login' }))
  ];
  const referral = await resolveInvite(db, inviteToken, userId);
  if (referral) statements.push(
    db.prepare('INSERT INTO referral_relationships (id, referred_user_id, referrer_user_id, invite_link_id) VALUES (?, ?, ?, ?)')
      .bind(newId('referral'), userId, referral.inviterUserId, referral.inviteLinkId),
    db.prepare('INSERT INTO audit_logs (id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, ?)')
      .bind(newId('audit'), userId, 'referral.confirmed', JSON.stringify({ inviteLinkId: referral.inviteLinkId }))
  );
  await db.batch(statements);
  return { member: { userId, displayName, pictureUrl, phone: '', email, status: 'active' }, created: true, referralCreated: Boolean(referral) };
}

async function resolveInvite(db, inviteToken, referredUserId) {
  const rawToken = String(inviteToken || '').trim();
  if (!rawToken || rawToken.length > 512) return null;
  const tokenHash = await sha256(rawToken);
  const row = await db.prepare(`
    SELECT id, inviter_user_id
    FROM invite_links
    WHERE token_hash = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `).bind(tokenHash).first();
  if (!row || row.inviter_user_id === referredUserId) return null;
  return { inviteLinkId: row.id, inviterUserId: row.inviter_user_id };
}

export async function getMember(db, userId) {
  const row = await db.prepare(`
    SELECT pu.id AS user_id, pu.status, mp.display_name, mp.picture_url, mp.phone, mp.email
    FROM platform_users pu LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
    WHERE pu.id = ?
  `).bind(userId).first();
  return profileFromRow(row);
}

export async function updateMemberProfile(db, userId, profile) {
  const displayName = String(profile.displayName || '').trim().slice(0, 120);
  const phone = String(profile.phone || '').trim().slice(0, 40);
  if (!displayName) throw new Error('displayName is required');
  await db.prepare(`
    UPDATE member_profiles SET display_name = ?, phone = ?, profile_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE platform_user_id = ?
  `).bind(displayName, phone, userId).run();
  return getMember(db, userId);
}

export async function isAdminMember(db, userId, configuredSubjects) {
  const allowed = new Set(String(configuredSubjects || '').split(',').map(value => value.trim()).filter(Boolean));
  if (!allowed.size) return false;
  const identity = await db.prepare(`SELECT provider_subject FROM external_identities WHERE platform_user_id = ? AND provider = 'line_login' AND verification_status = 'verified'`)
    .bind(userId).first();
  return Boolean(identity?.provider_subject && allowed.has(identity.provider_subject));
}

export async function createInviteLink(db, userId, rawToken) {
  const token = String(rawToken || '').trim();
  if (token.length < 24 || token.length > 512) throw new Error('Invalid invite token');
  const linkId = newId('invite');
  await db.prepare('INSERT INTO invite_links (id, inviter_user_id, token_hash) VALUES (?, ?, ?)')
    .bind(linkId, userId, await sha256(token)).run();
  return { id: linkId, token };
}
