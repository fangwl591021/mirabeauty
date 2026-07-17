-- Cover artwork for the simulated recurring business briefing course.
UPDATE courses
SET cover_url = '/course-business-briefing.webp', updated_at = CURRENT_TIMESTAMP
WHERE id = 'course_demo_business_briefing';
