-- 直銷公司既有會員編號；與系統自動產生的 MB- 系統會員編號分開保存。
ALTER TABLE member_profiles ADD COLUMN company_member_number TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_profiles_company_member_number
ON member_profiles(company_member_number)
WHERE company_member_number <> '';
