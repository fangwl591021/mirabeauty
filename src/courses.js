import { sha256 } from './auth.js';
import { newId } from './member-repository.js';
import { awardPoints, awardReferralAttendancePoints } from './points.js';

function isWithinWindow(now, opensAt, closesAt) {
  const opens = Date.parse(opensAt);
  const closes = Date.parse(closesAt);
  return Number.isFinite(opens) && Number.isFinite(closes) && now >= opens && now <= closes;
}
function publicSession(row) {
  return {
    sessionId: row.session_id,
    courseId: row.course_id,
    courseTitle: row.course_title,
    courseDescription: row.course_description,
    coverUrl: row.session_cover_url || row.cover_url,
    title: row.session_title,
    mode: row.attendance_mode,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    meetingUrl: row.meeting_url,
    checkinOpensAt: row.checkin_opens_at,
    checkinClosesAt: row.checkin_closes_at,
    registeredAt: row.registered_at || '',
    attendanceAt: row.attendance_at || ''
  };
}

export async function listPublicCourseSessions(db) {
  const result = await db.prepare(`
    SELECT cs.id AS session_id, cs.course_id, c.title AS course_title, c.description AS course_description, c.cover_url, cs.cover_url AS session_cover_url,
      cs.title AS session_title, cs.attendance_mode, cs.starts_at, cs.ends_at, cs.venue_name, cs.venue_address,
      cs.meeting_url, cs.checkin_opens_at, cs.checkin_closes_at
    FROM course_sessions cs JOIN courses c ON c.id = cs.course_id
    WHERE c.status = 'published' AND cs.status = 'scheduled'
    ORDER BY cs.starts_at ASC
  `).all();
  return (result.results || []).map(publicSession);
}

// Direct port of the MLM calendar source, with course_sessions as the single
// event table.  This prevents the calendar and the member course area from
// drifting into two independent registrations.
export async function listCalendarSessions(db, { from = '', to = '' } = {}) {
  const clauses = [];
  const values = [];
  if (from) { clauses.push('cs.starts_at >= ?'); values.push(from); }
  if (to) { clauses.push('cs.starts_at < ?'); values.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await db.prepare(`
    SELECT cs.id AS session_id, cs.course_id, c.title AS course_title, c.description AS course_description, c.cover_url, cs.cover_url AS session_cover_url,
      cs.title AS session_title, cs.attendance_mode, cs.starts_at, cs.ends_at, cs.venue_name, cs.venue_address,
      cs.meeting_url, cs.checkin_opens_at, cs.checkin_closes_at, cs.status AS session_status, c.status AS course_status
    FROM course_sessions cs JOIN courses c ON c.id = cs.course_id
    ${where}
    ORDER BY cs.starts_at ASC
  `).bind(...values).all();
  return (result.results || []).map(row => ({ ...publicSession(row), sessionStatus: row.session_status, courseStatus: row.course_status }));
}

export async function listAdminCourses(db) {
  const result = await db.prepare(`
    SELECT id, title, description, status, created_at, updated_at
    FROM courses
    WHERE id NOT LIKE 'calendar_course_%'
    ORDER BY created_at DESC
  `).all();
  return result.results || [];
}

export async function saveCalendarSession(db, body) {
  // Keep the MLM calendar contract: an activity is independently saveable.
  // Every calendar event owns an internal published course record. The internal
  // record keeps registration, attendance and points on one source without
  // exposing a confusing course-link selector in the calendar editor.
  const title = String(body.title || '').trim();
  const mode = String(body.mode || '').trim();
  const startsAt = String(body.startsAt || '').trim();
  const endsAt = String(body.endsAt || '').trim();
  const checkinOpensAt = String(body.checkinOpensAt || '').trim();
  const checkinClosesAt = String(body.checkinClosesAt || '').trim();
  const coverUrl = String(body.coverUrl || '').trim().slice(0, 4096);
  if (!title) return { ok: false, reason: 'calendar_title_required' };
  if (!['physical', 'online'].includes(mode) || !startsAt || !endsAt || !checkinOpensAt || !checkinClosesAt) {
    return { ok: false, reason: 'missing_calendar_fields' };
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt) || Date.parse(checkinClosesAt) <= Date.parse(checkinOpensAt)) {
    return { ok: false, reason: 'invalid_calendar_range' };
  }

  const id = String(body.id || '').trim() || newId('session');
  const courseId = `calendar_course_${id}`;
  await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO courses (id, title, description, cover_url, status, created_by_user_id)
      VALUES (?, ?, ?, '', 'published', NULL)
    `).bind(courseId, title, '由行事曆活動自動建立'),
    db.prepare(`UPDATE courses SET title = ?, cover_url = ?, status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(title, coverUrl, courseId),
  ]);
  const existing = await db.prepare('SELECT id FROM course_sessions WHERE id = ?').bind(id).first();
  const codeHash = body.checkinCode ? await sha256(String(body.checkinCode)) : '';
  if (existing) {
    const codeSql = body.checkinCode ? ', checkin_code_hash = ?' : '';
    const binds = [courseId, title, mode, startsAt, endsAt, String(body.venueName || ''), String(body.venueAddress || ''), String(body.meetingUrl || ''), checkinOpensAt, checkinClosesAt, coverUrl];
    if (body.checkinCode) binds.push(codeHash);
    binds.push(String(body.status || 'scheduled'), id);
    await db.prepare(`UPDATE course_sessions SET course_id = ?, title = ?, attendance_mode = ?, starts_at = ?, ends_at = ?, venue_name = ?, venue_address = ?, meeting_url = ?, checkin_opens_at = ?, checkin_closes_at = ?, cover_url = ?${codeSql}, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...binds).run();
  } else {
    await db.prepare(`INSERT INTO course_sessions (id, course_id, title, attendance_mode, starts_at, ends_at, venue_name, venue_address, meeting_url, checkin_opens_at, checkin_closes_at, cover_url, checkin_code_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, courseId, title, mode, startsAt, endsAt, String(body.venueName || ''), String(body.venueAddress || ''), String(body.meetingUrl || ''), checkinOpensAt, checkinClosesAt, coverUrl, codeHash, String(body.status || 'scheduled')).run();
  }
  return { ok: true, id };
}

export async function cancelCalendarSession(db, sessionId) {
  const result = await db.prepare(`UPDATE course_sessions SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(sessionId).run();
  return Boolean(result.meta?.changes);
}

export async function listMyCourseSessions(db, userId) {
  const result = await db.prepare(`
    SELECT cr.status AS registration_status, cr.registered_at, ar.status AS attendance_status, ar.checked_in_at AS attendance_at,
      cs.id AS session_id, cs.course_id, c.title AS course_title, c.description AS course_description, c.cover_url, cs.cover_url AS session_cover_url,
      cs.title AS session_title, cs.attendance_mode, cs.starts_at, cs.ends_at, cs.venue_name, cs.venue_address,
      cs.meeting_url, cs.checkin_opens_at, cs.checkin_closes_at
    FROM course_registrations cr
    JOIN course_sessions cs ON cs.id = cr.course_session_id
    JOIN courses c ON c.id = cs.course_id
    LEFT JOIN attendance_records ar ON ar.course_session_id = cr.course_session_id AND ar.platform_user_id = cr.platform_user_id
    WHERE cr.platform_user_id = ?
    ORDER BY cs.starts_at DESC
  `).bind(userId).all();
  return (result.results || []).map(row => ({ ...publicSession(row), registrationStatus: row.registration_status, attendanceStatus: row.attendance_status || '' }));
}

export async function registerForSession(db, userId, sessionId, source = 'member_portal') {
  const session = await db.prepare(`
    SELECT cs.id, cs.status, c.status AS course_status
    FROM course_sessions cs JOIN courses c ON c.id = cs.course_id WHERE cs.id = ?
  `).bind(sessionId).first();
  if (!session || session.course_status !== 'published' || session.status !== 'scheduled') return { ok: false, reason: 'session_unavailable' };
  const registrationId = newId('registration');
  try {
    await db.prepare('INSERT INTO course_registrations (id, course_session_id, platform_user_id, source) VALUES (?, ?, ?, ?)')
      .bind(registrationId, sessionId, userId, String(source || 'member_portal').slice(0, 40)).run();
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE constraint failed: course_registrations.course_session_id, course_registrations.platform_user_id')) {
      return { ok: true, duplicate: true };
    }
    throw error;
  }
  const pointResult = await awardPoints(db, {
    userId,
    eventType: 'course_registered',
    eventReference: sessionId,
    idempotencyKey: `course_registered:${sessionId}:${userId}`,
    metadata: { registrationId }
  });
  return { ok: true, duplicate: false, registrationId, pointResult };
}

async function recordAttempt(db, { sessionId, userId, method, result, reasonCode }) {
  await db.prepare(`
    INSERT INTO attendance_attempts (id, course_session_id, platform_user_id, method, result, reason_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(newId('attendance_attempt'), sessionId, userId, method, result, reasonCode).run();
}

export async function checkInToSession(db, { userId, sessionId, method, code, smartCheckin = false, now = Date.now() }) {
  const normalizedMethod = String(method || '').trim();
  if (!['physical_qr', 'physical_code', 'online_keyword'].includes(normalizedMethod)) return { ok: false, reason: 'invalid_method' };
  const row = await db.prepare(`
    SELECT cs.id, cs.attendance_mode, cs.status, cs.checkin_opens_at, cs.checkin_closes_at, cs.checkin_code_hash,
      c.status AS course_status, cr.id AS registration_id, cr.status AS registration_status
    FROM course_sessions cs JOIN courses c ON c.id = cs.course_id
    LEFT JOIN course_registrations cr ON cr.course_session_id = cs.id AND cr.platform_user_id = ?
    WHERE cs.id = ?
  `).bind(userId, sessionId).first();
  const reject = async reason => {
    if (row) await recordAttempt(db, { sessionId, userId, method: normalizedMethod, result: 'rejected', reasonCode: reason });
    return { ok: false, reason };
  };
  if (!row || row.course_status !== 'published' || row.status !== 'scheduled') return reject('session_unavailable');
  if (row.registration_status !== 'registered') return reject('registration_required');
  if (row.attendance_mode === 'physical' && !normalizedMethod.startsWith('physical_')) return reject('method_not_allowed');
  if (row.attendance_mode === 'online' && normalizedMethod !== 'online_keyword') return reject('method_not_allowed');
  if (!isWithinWindow(now, row.checkin_opens_at, row.checkin_closes_at)) return reject('outside_checkin_window');
  if (!smartCheckin && (!code || !row.checkin_code_hash || await sha256(String(code).trim()) !== row.checkin_code_hash)) return reject('invalid_checkin_code');

  const attendanceId = newId('attendance');
  try {
    await db.batch([
      db.prepare(`INSERT INTO attendance_records (id, course_session_id, platform_user_id, registration_id, method) VALUES (?, ?, ?, ?, ?)`)
        .bind(attendanceId, sessionId, userId, row.registration_id, normalizedMethod),
      db.prepare(`INSERT INTO attendance_attempts (id, course_session_id, platform_user_id, method, result) VALUES (?, ?, ?, ?, 'accepted')`)
        .bind(newId('attendance_attempt'), sessionId, userId, normalizedMethod)
    ]);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE constraint failed: attendance_records.course_session_id, attendance_records.platform_user_id')) {
      return { ok: true, duplicate: true };
    }
    throw error;
  }
  const pointResult = await awardPoints(db, {
    userId,
    eventType: 'attendance_verified',
    eventReference: sessionId,
    idempotencyKey: `attendance_verified:${sessionId}:${userId}`,
    metadata: { attendanceId, method: normalizedMethod }
  });
  const referrerPointResult = await awardReferralAttendancePoints(db, {
    referredUserId: userId,
    sessionId,
    attendanceId,
  });
  return { ok: true, duplicate: false, attendanceId, pointResult, referrerPointResult };
}

export async function smartCheckInToActiveSession(db, { userId }) {
  const now = new Date().toISOString();
  const result = await db.prepare(`SELECT cs.id, cs.attendance_mode
    FROM course_sessions cs JOIN courses c ON c.id = cs.course_id
    JOIN course_registrations cr ON cr.course_session_id = cs.id AND cr.platform_user_id = ? AND cr.status = 'registered'
    WHERE cs.status = 'scheduled' AND c.status = 'published'
      AND cs.checkin_opens_at <= ? AND cs.checkin_closes_at >= ? ORDER BY cs.starts_at ASC LIMIT 1`).bind(userId, now, now).first();
  if (!result) {
    const active = await db.prepare(`SELECT 1 FROM course_sessions cs JOIN courses c ON c.id = cs.course_id WHERE cs.status = 'scheduled' AND c.status = 'published' AND cs.checkin_opens_at <= ? AND cs.checkin_closes_at >= ? LIMIT 1`).bind(now, now).first();
    return { ok: false, reason: active ? 'registration_required' : 'no_active_session' };
  }
  return checkInToSession(db, { userId, sessionId: result.id, method: result.attendance_mode === 'online' ? 'online_keyword' : 'physical_qr', smartCheckin: true });
}
