ALTER TABLE member_crm_insights ADD COLUMN analysis_version TEXT NOT NULL DEFAULT '';

-- 既有內容使用的是泛用 CRM 文案規則；排回佇列，改以 LINE- 命理五大標籤規則重算。
UPDATE member_crm_insights
SET status='queued', insights_json='{}', last_error='', analysis_version='', updated_at=datetime('now','-11 minutes');
