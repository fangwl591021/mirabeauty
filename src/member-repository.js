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
    gender: row.gender || '',
    birthday: row.birthday || '',
    memberNumber: row.member_number || '',
    companyMemberNumber: row.company_member_number || '',
    profileCompletedAt: row.profile_completed_at || '',
    systemReferrer: row.referrer_user_id ? {
      userId: row.referrer_user_id,
      displayName: row.referrer_name || '',
      memberNumber: row.referrer_member_number || ''
    } : null,
    status: row.status
  };
}

const memberFields = `
  mp.display_name, mp.picture_url, mp.phone, mp.email, mp.gender, mp.birthday, mp.member_number, mp.company_member_number, mp.profile_completed_at,
  rr.referrer_user_id, ref_mp.display_name AS referrer_name, ref_mp.member_number AS referrer_member_number
`;

export async function resolveLineMember(db, lineProfile, inviteToken = '') {
  const identity = await db.prepare(`
    SELECT ei.platform_user_id AS user_id, pu.status, ${memberFields}
    FROM external_identities ei
    JOIN platform_users pu ON pu.id = ei.platform_user_id
    LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
    LEFT JOIN referral_relationships rr ON rr.referred_user_id = pu.id AND rr.status = 'active'
    LEFT JOIN member_profiles ref_mp ON ref_mp.platform_user_id = rr.referrer_user_id
    WHERE ei.provider = 'line_login' AND ei.provider_subject = ? AND ei.verification_status = 'verified'
  `).bind(lineProfile.sub).first();

  if (identity) {
    await db.prepare('UPDATE external_identities SET last_verified_at = CURRENT_TIMESTAMP WHERE provider = ? AND provider_subject = ?')
      .bind('line_login', lineProfile.sub).run();
    if (lineProfile.picture) await db.prepare('UPDATE member_profiles SET picture_url = ?, updated_at = CURRENT_TIMESTAMP WHERE platform_user_id = ?')
      .bind(String(lineProfile.picture).slice(0, 2048), identity.user_id).run();
    identity.picture_url = String(lineProfile.picture || identity.picture_url || '');
    // LINE 登入可能會經過外部跳轉；若帳號已建立但尚未有推薦人，
    // 仍允許以第一個有效邀約連結補上歸屬。
    const referral = identity.referrer_user_id ? null : await resolveInvite(db, inviteToken, identity.user_id);
    if (referral) {
      await db.batch([
        db.prepare('INSERT INTO referral_relationships (id, referred_user_id, referrer_user_id, invite_link_id) VALUES (?, ?, ?, ?)')
          .bind(newId('referral'), identity.user_id, referral.inviterUserId, referral.inviteLinkId),
        db.prepare('INSERT INTO audit_logs (id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, ?)')
          .bind(newId('audit'), identity.user_id, 'referral.confirmed', JSON.stringify({ inviteLinkId: referral.inviteLinkId, recovered: true }))
      ]);
      identity.referrer_user_id = referral.inviterUserId;
      identity.referrer_name = '';
      identity.referrer_member_number = '';
    }
    return { member: profileFromRow(identity), created: false, referralCreated: Boolean(referral) };
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
    db.prepare('INSERT INTO member_profiles (platform_user_id, display_name, picture_url, email, member_number) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, displayName, pictureUrl, email, `MB-${userId.slice(-8).toUpperCase()}`),
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
  return { member: { userId, displayName, pictureUrl, phone: '', email, gender: '', birthday: '', memberNumber: `MB-${userId.slice(-8).toUpperCase()}`, companyMemberNumber: '', profileCompletedAt: '', systemReferrer: referral ? { userId: referral.inviterUserId, displayName: '', memberNumber: '' } : null, status: 'active' }, created: true, referralCreated: Boolean(referral) };
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
    SELECT pu.id AS user_id, pu.status, ${memberFields}
    FROM platform_users pu
    LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
    LEFT JOIN referral_relationships rr ON rr.referred_user_id = pu.id AND rr.status = 'active'
    LEFT JOIN member_profiles ref_mp ON ref_mp.platform_user_id = rr.referrer_user_id
    WHERE pu.id = ?
  `).bind(userId).first();
  return profileFromRow(row);
}

export async function updateMemberProfile(db, userId, profile) {
  const displayName = String(profile.displayName || '').trim().slice(0, 120);
  const phone = String(profile.phone || '').trim().slice(0, 40);
  const gender = String(profile.gender || '').trim();
  const birthday = String(profile.birthday || '').trim();
  const companyMemberNumber = String(profile.companyMemberNumber || '').trim().slice(0, 80);
  if (!displayName) throw new Error('displayName is required');
  if (!['female', 'male', 'other', 'prefer_not_to_say'].includes(gender)) throw new Error('gender is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new Error('請選擇生日');
  const parsedBirthday = new Date(`${birthday}T00:00:00Z`);
  if (Number.isNaN(parsedBirthday.getTime()) || parsedBirthday.toISOString().slice(0, 10) !== birthday || parsedBirthday > new Date()) throw new Error('生日日期不正確');
  if (!companyMemberNumber) throw new Error('companyMemberNumber is required');
  await db.prepare(`
    UPDATE member_profiles SET display_name = ?, phone = ?, gender = ?, birthday = ?, company_member_number = ?, profile_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE platform_user_id = ?
  `).bind(displayName, phone, gender, birthday, companyMemberNumber, userId).run();
  return getMember(db, userId);
}

export async function getAdminAccess(db, userId, configuredSubjects) {
  const allowed = new Set(String(configuredSubjects || '').split(',').map(value => value.trim()).filter(Boolean));
  const identity = await db.prepare(`SELECT provider_subject FROM external_identities WHERE platform_user_id = ? AND provider = 'line_login' AND verification_status = 'verified'`)
    .bind(userId).first();
  const owner = Boolean(identity?.provider_subject && allowed.has(identity.provider_subject));
  if (owner) return {
    canAccessAdmin: true,
    canManagePermissions: true,
    canManagePoints: true,
    canManageRichMenu: true,
    systemAccess: true,
    operatorAccess: false,
    role: 'owner'
  };
  const permission = await db.prepare(`SELECT system_access, operator_access FROM admin_member_permissions WHERE platform_user_id = ?`)
    .bind(userId).first();
  const systemAccess = Number(permission?.system_access || 0) === 1;
  const operatorAccess = Number(permission?.operator_access || 0) === 1;
  return {
    canAccessAdmin: systemAccess || operatorAccess,
    canManagePermissions: false,
    canManagePoints: systemAccess,
    canManageRichMenu: systemAccess,
    systemAccess,
    operatorAccess,
    role: systemAccess ? 'system' : operatorAccess ? 'operator' : 'member'
  };
}

export async function isAdminMember(db, userId, configuredSubjects) {
  return (await getAdminAccess(db, userId, configuredSubjects)).canAccessAdmin;
}

export async function createInviteLink(db, userId, rawToken) {
  const token = String(rawToken || '').trim();
  if (token.length < 24 || token.length > 512) throw new Error('Invalid invite token');
  const linkId = newId('invite');
  await db.prepare('INSERT INTO invite_links (id, inviter_user_id, token_hash) VALUES (?, ?, ?)')
    .bind(linkId, userId, await sha256(token)).run();
  return { id: linkId, token };
}
