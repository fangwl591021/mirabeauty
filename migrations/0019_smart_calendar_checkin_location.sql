-- Fixed QR smart check-in: every physical session must carry a geofence.
ALTER TABLE course_sessions ADD COLUMN venue_latitude REAL NOT NULL DEFAULT 0;
ALTER TABLE course_sessions ADD COLUMN venue_longitude REAL NOT NULL DEFAULT 0;
ALTER TABLE course_sessions ADD COLUMN checkin_radius_meters INTEGER NOT NULL DEFAULT 150;

-- Demo venue: Taipei Main Station area, only for the seeded mock activity.
UPDATE course_sessions
SET venue_latitude = 25.0479,
    venue_longitude = 121.5171,
    checkin_radius_meters = 150
WHERE course_id = 'course_demo_business_briefing';
