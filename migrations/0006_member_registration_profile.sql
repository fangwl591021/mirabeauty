ALTER TABLE member_profiles ADD COLUMN gender TEXT NOT NULL DEFAULT '' CHECK (gender IN ('', 'female', 'male', 'other', 'prefer_not_to_say'));
ALTER TABLE member_profiles ADD COLUMN member_number TEXT NOT NULL DEFAULT '';

UPDATE member_profiles
SET member_number = 'MB-' || printf('%06d', rowid)
WHERE member_number = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_profiles_member_number
ON member_profiles(member_number);
