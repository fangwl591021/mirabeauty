-- 收藏名片與個人名片共用同一套數位名片版型設定。
-- 原始掃描圖仍保留在 front_r2_key；這裡只保存裁切後的公開封面與版型內容。
ALTER TABLE contact_cards ADD COLUMN selected_version TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE contact_cards ADD COLUMN versions_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE contact_cards ADD COLUMN chat_alt_text TEXT NOT NULL DEFAULT '';
