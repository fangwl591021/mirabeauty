-- Action CRM 同步欄位：由管理員在會員檔案中維護。
ALTER TABLE member_profiles ADD COLUMN industry TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN birthday TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN admin_note TEXT NOT NULL DEFAULT '';
