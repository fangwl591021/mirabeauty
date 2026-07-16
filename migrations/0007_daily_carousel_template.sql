ALTER TABLE ad_campaigns ADD COLUMN rotation_mode TEXT NOT NULL DEFAULT 'sequential' CHECK (rotation_mode IN ('sequential', 'random'));
ALTER TABLE ad_creatives ADD COLUMN image_link TEXT NOT NULL DEFAULT '';
ALTER TABLE ad_creatives ADD COLUMN buttons_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ad_creatives ADD COLUMN bubble_size TEXT NOT NULL DEFAULT 'nano';
ALTER TABLE ad_creatives ADD COLUMN image_aspect_ratio TEXT NOT NULL DEFAULT '400:600';
ALTER TABLE ad_creatives ADD COLUMN image_aspect_mode TEXT NOT NULL DEFAULT 'cover';
