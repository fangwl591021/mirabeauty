-- Demo recurring event for calendar / QR-enrolment testing.
-- Create 26 weeks of Tuesday + Thursday sessions in Taipei time.  Stored as
-- UTC so the existing member and admin interfaces render 19:30–21:00 (UTC+8).
INSERT OR IGNORE INTO courses (id, title, description, status)
VALUES (
  'course_demo_business_briefing',
  '常態事業說明會（模擬）',
  '模擬常態活動：每週二、週四晚上 19:30–21:00；報到／簽到時間為 19:00–19:30。可用於測試行事曆、活動 QR 報名與簽到贈點流程。',
  'published'
);

WITH RECURSIVE weeks(n, week_start) AS (
  SELECT 0, date('now', '+8 hours', 'weekday 1', '-7 days')
  UNION ALL
  SELECT n + 1, date(week_start, '+7 days') FROM weeks WHERE n < 25
), occurrences(day) AS (
  SELECT date(week_start, '+1 day') FROM weeks -- Tuesday
  UNION ALL
  SELECT date(week_start, '+3 days') FROM weeks -- Thursday
)
INSERT OR IGNORE INTO course_sessions
  (id, course_id, title, attendance_mode, starts_at, ends_at, venue_name, venue_address, meeting_url, checkin_opens_at, checkin_closes_at, status)
SELECT
  'session_demo_briefing_' || replace(day, '-', ''),
  'course_demo_business_briefing',
  '事業說明會',
  'physical',
  strftime('%Y-%m-%dT%H:%M:%SZ', day || ' 11:30:00'),
  strftime('%Y-%m-%dT%H:%M:%SZ', day || ' 13:00:00'),
  'MiraBeauty 模擬會場',
  '測試用常態活動',
  '',
  strftime('%Y-%m-%dT%H:%M:%SZ', day || ' 11:00:00'),
  strftime('%Y-%m-%dT%H:%M:%SZ', day || ' 11:30:00'),
  'scheduled'
FROM occurrences
WHERE day >= date('now', '+8 hours');
