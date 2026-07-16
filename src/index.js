import { createSession, sha256, verifyLineIdToken, verifySession } from './auth.js';
import { createInviteLink, getMember, isAdminMember, newId, resolveLineMember, updateMemberProfile } from './member-repository.js';
import { getWallet } from './points.js';
import { checkInToSession, listMyCourseSessions, listPublicCourseSessions, registerForSession } from './courses.js';
import { checkInDailyAd, getDailyAdCampaign, recordAdViewProgress, startAdView } from './daily-ad.js';
import { issueWalletToken, resolveWalletToken } from './wallet-qr.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function badRequest(message) { return json({ success: false, error: message }, 400); }

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function currentMember(request, env) {
  if (!env.SESSION_SIGNING_SECRET) return null;
  const session = await verifySession(bearerToken(request), env.SESSION_SIGNING_SECRET);
  if (!session) return null;
  return getMember(env.DB, session.sub);
}

async function currentAdmin(request, env) {
  const member = await currentMember(request, env);
  if (!member || !await isAdminMember(env.DB, member.userId, env.ADMIN_LINE_SUBJECTS)) return null;
  return member;
}

function randomInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function app(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json({ success: true, service: 'mirabeauty-member-crm', version: '0.1.0' });
  }

  if (request.method === 'GET' && url.pathname === '/api/config') {
    return json({ success: true, liffId: env.LIFF_ID || '', officialAccountUrl: 'https://lin.ee/sV9xDLr' });
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/line/verify') {
    if (!env.DB || !env.LINE_LOGIN_CHANNEL_ID || !env.SESSION_SIGNING_SECRET) return json({ success: false, error: 'Service is not configured' }, 503);
    const body = await readJson(request);
    if (!body?.idToken) return badRequest('idToken is required');
    const lineProfile = await verifyLineIdToken(body.idToken, env.LINE_LOGIN_CHANNEL_ID);
    if (!lineProfile) return json({ success: false, error: 'Invalid LINE ID token' }, 401);
    const result = await resolveLineMember(env.DB, lineProfile, body.inviteToken);
    if (result.member.status !== 'active') return json({ success: false, error: 'Member is unavailable' }, 403);
    const sessionToken = await createSession(result.member.userId, env.SESSION_SIGNING_SECRET);
    return json({ success: true, ...result, sessionToken, expiresIn: 604800 }, result.created ? 201 : 200);
  }

  if (request.method === 'GET' && url.pathname === '/v1/me') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    return json({ success: true, member });
  }

  if (request.method === 'PATCH' && url.pathname === '/v1/me') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    try {
      const updated = await updateMemberProfile(env.DB, member.userId, await readJson(request) || {});
      return json({ success: true, member: updated });
    } catch (error) {
      return badRequest(error.message || 'Unable to save profile');
    }
  }

  if (request.method === 'GET' && url.pathname === '/v1/points/wallet') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    return json({ success: true, wallet: await getWallet(env.DB, member.userId) });
  }

  if (request.method === 'POST' && url.pathname === '/v1/points/wallet/qr') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    const body = await readJson(request) || {};
    try {
      const walletToken = await issueWalletToken(env.DB, member.userId, body.purpose || 'member_identification');
      return json({
        success: true,
        ...walletToken,
        qrPayload: `${url.origin}/w/${walletToken.token}`
      }, 201);
    } catch (error) {
      return badRequest(error.message || 'Unable to issue wallet QR');
    }
  }

  if (request.method === 'POST' && url.pathname === '/v1/wallet-scans/resolve') {
    const scannerKey = request.headers.get('x-wallet-scanner-key') || '';
    if (!env.WALLET_SCANNER_API_KEY || scannerKey !== env.WALLET_SCANNER_API_KEY) return json({ success: false, error: 'Unauthorized scanner' }, 401);
    const body = await readJson(request) || {};
    const result = await resolveWalletToken(env.DB, body.token, body.scannerLabel || '');
    return result.ok ? json({ success: true, ...result }) : json({ success: false, error: result.reason }, 400);
  }

  if (url.pathname.startsWith('/v1/admin/')) {
    const admin = await currentAdmin(request, env);
    if (!admin) return json({ success: false, error: 'Administrator access required' }, 403);
    if (request.method === 'GET' && url.pathname === '/v1/admin/overview') {
      const [members, courses, campaigns, points, checkins] = await env.DB.batch([
        env.DB.prepare('SELECT COUNT(*) AS count FROM platform_users WHERE status = \'active\''),
        env.DB.prepare('SELECT COUNT(*) AS count FROM courses WHERE status = \'published\''),
        env.DB.prepare('SELECT COUNT(*) AS count FROM ad_campaigns WHERE status = \'active\''),
        env.DB.prepare('SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS count FROM point_ledger_entries'),
        env.DB.prepare('SELECT COUNT(*) AS count FROM daily_checkins WHERE status = \'verified\'')
      ]);
      return json({ success: true, overview: { members: Number(members.results[0].count), publishedCourses: Number(courses.results[0].count), activeCampaigns: Number(campaigns.results[0].count), issuedPoints: Number(points.results[0].count), verifiedCheckins: Number(checkins.results[0].count) } });
    }
    const body = await readJson(request) || {};
    if (request.method === 'POST' && url.pathname === '/v1/admin/point-rules') {
      const eventType = String(body.eventType || '').trim();
      const points = Number(body.points);
      if (!eventType || !Number.isInteger(points) || points < 0) return badRequest('Invalid point rule');
      const ruleId = newId('pointrule');
      await env.DB.prepare(`INSERT INTO point_rules (id, program_id, event_type, points, daily_limit, status, rule_version) VALUES (?, 'program_main', ?, ?, ?, ?, ?)`)
        .bind(ruleId, eventType, points, body.dailyLimit ?? null, body.status || 'draft', body.ruleVersion || 'v1').run();
      return json({ success: true, id: ruleId }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/v1/admin/courses') {
      const title = String(body.title || '').trim(); if (!title) return badRequest('title is required');
      const id = newId('course');
      await env.DB.prepare(`INSERT INTO courses (id, title, description, cover_url, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, title, String(body.description || ''), String(body.coverUrl || ''), body.status || 'draft', admin.userId).run();
      return json({ success: true, id }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/v1/admin/course-sessions') {
      const required=['courseId','mode','startsAt','endsAt','checkinOpensAt','checkinClosesAt']; if(required.some(k=>!body[k])) return badRequest('Missing course session fields');
      if (!['physical','online'].includes(body.mode)) return badRequest('Invalid mode');
      const id = newId('session');
      const codeHash = body.checkinCode ? await sha256(String(body.checkinCode)) : '';
      await env.DB.prepare(`INSERT INTO course_sessions (id, course_id, title, attendance_mode, starts_at, ends_at, venue_name, venue_address, meeting_url, checkin_opens_at, checkin_closes_at, checkin_code_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, body.courseId, String(body.title || ''), body.mode, body.startsAt, body.endsAt, String(body.venueName || ''), String(body.venueAddress || ''), String(body.meetingUrl || ''), body.checkinOpensAt, body.checkinClosesAt, codeHash).run();
      return json({ success: true, id }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/v1/admin/ad-campaigns') {
      if (!body.name || !body.startsAt || !body.endsAt) return badRequest('Missing campaign fields');
      const id = newId('campaign');
      await env.DB.prepare(`INSERT INTO ad_campaigns (id, name, status, starts_at, ends_at, required_creative_count) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, String(body.name), body.status || 'draft', body.startsAt, body.endsAt, Math.max(1, Number(body.requiredCreativeCount) || 1)).run();
      return json({ success: true, id }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/v1/admin/ad-creatives') {
      if (!body.campaignId || !body.type || !body.mediaUrl || !['image','video','article'].includes(body.type)) return badRequest('Invalid creative');
      const id = newId('creative');
      await env.DB.prepare(`INSERT INTO ad_creatives (id, campaign_id, creative_type, title, media_url, preview_url, target_url, required_watch_seconds, required_completion_ratio, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, body.campaignId, body.type, String(body.title || ''), body.mediaUrl, String(body.previewUrl || ''), String(body.targetUrl || ''), Math.max(0, Number(body.requiredWatchSeconds) || 3), Math.min(1, Math.max(0, Number(body.requiredCompletionRatio) || 0)), Number(body.displayOrder) || 0).run();
      return json({ success: true, id }, 201);
    }
    return json({ success: false, error: 'Admin endpoint not found' }, 404);
  }

  if (request.method === 'GET' && url.pathname === '/v1/courses') {
    return json({ success: true, sessions: await listPublicCourseSessions(env.DB) });
  }

  if (request.method === 'GET' && url.pathname === '/v1/courses/my') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    return json({ success: true, sessions: await listMyCourseSessions(env.DB, member.userId) });
  }

  if (request.method === 'GET' && url.pathname === '/v1/daily-ad') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    const dailyAd = await getDailyAdCampaign(env.DB, member.userId);
    return dailyAd ? json({ success: true, ...dailyAd }) : json({ success: true, campaign: null, creatives: [] });
  }

  if (request.method === 'POST' && url.pathname === '/v1/daily-ad/view-sessions') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    const body = await readJson(request) || {};
    const result = await startAdView(env.DB, member.userId, body.creativeId);
    return result.ok ? json({ success: true, ...result }, 201) : badRequest(result.reason);
  }

  const adProgressMatch = url.pathname.match(/^\/v1\/daily-ad\/view-sessions\/([^/]+)\/progress$/);
  if (request.method === 'POST' && adProgressMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    const body = await readJson(request) || {};
    const result = await recordAdViewProgress(env.DB, {
      userId: member.userId,
      token: decodeURIComponent(adProgressMatch[1]),
      watchedSeconds: body.watchedSeconds,
      completionRatio: body.completionRatio,
      pageVisible: body.pageVisible !== false
    });
    return result.ok ? json({ success: true, ...result }) : badRequest(result.reason);
  }

  if (request.method === 'POST' && url.pathname === '/v1/daily-ad/check-in') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    const result = await checkInDailyAd(env.DB, member.userId);
    return result.ok ? json({ success: true, ...result }, result.duplicate ? 200 : 201) : badRequest(result.reason);
  }

  const registrationMatch = url.pathname.match(/^\/v1\/course-sessions\/([^/]+)\/register$/);
  if (request.method === 'POST' && registrationMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    const result = await registerForSession(env.DB, member.userId, decodeURIComponent(registrationMatch[1]));
    return result.ok ? json({ success: true, ...result }, result.duplicate ? 200 : 201) : badRequest(result.reason);
  }

  const checkinMatch = url.pathname.match(/^\/v1\/course-sessions\/([^/]+)\/check-in$/);
  if (request.method === 'POST' && checkinMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    const body = await readJson(request) || {};
    const result = await checkInToSession(env.DB, {
      userId: member.userId,
      sessionId: decodeURIComponent(checkinMatch[1]),
      method: body.method,
      code: body.code
    });
    return result.ok ? json({ success: true, ...result }, result.duplicate ? 200 : 201) : badRequest(result.reason);
  }

  if (request.method === 'POST' && url.pathname === '/v1/invite-links') {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: 'Unauthorized' }, 401);
    const body = await readJson(request) || {};
    const token = body.token || randomInviteToken();
    try {
    const invite = await createInviteLink(env.DB, member.userId, token);
      const shareUrl = `${url.origin}/i/${invite.token}`;
      return json({ success: true, invite: { id: invite.id, token: invite.token, url: shareUrl, qrPayload: shareUrl } }, 201);
    } catch (error) {
      return badRequest(error.message || 'Unable to create invite link');
    }
  }

  if (request.method === 'GET' && url.pathname.startsWith('/i/')) {
    const inviteToken = decodeURIComponent(url.pathname.slice(3));
    if (!inviteToken || inviteToken.length > 512) return new Response('Invalid invite link', { status: 400 });
    const loginUrl = new URL('/', url.origin);
    loginUrl.searchParams.set('invite', inviteToken);
    loginUrl.searchParams.set('oa', 'https://lin.ee/sV9xDLr');
    return Response.redirect(loginUrl.toString(), 302);
  }

  if (env.ASSETS) return env.ASSETS.fetch(request);
  return json({ success: false, error: 'Not Found' }, 404);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: { allow: 'GET, POST, OPTIONS' } });
    try { return await app(request, env); }
    catch (error) {
      console.error('Unhandled request error', error);
      return json({ success: false, error: 'Internal Server Error' }, 500);
    }
  }
};
