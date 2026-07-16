# MiraBeauty Member CRM

LINE Login 會員 CRM、單層邀約、點數、課程與任務系統的 Cloudflare Worker 基礎專案。

## Phase 1 現況

- `GET /api/health`：公開健康檢查。
- `POST /v1/auth/line/verify`：驗證 LINE Login ID Token，建立或登入會員。
- `GET /v1/me`：使用 Bearer Session Token 取得目前會員。
- `GET /v1/points/wallet`：查詢目前會員的點數錢包與最近 50 筆流水。
- `POST /v1/points/wallet/qr`：建立 60 秒有效的點數錢包 QR payload。
- `POST /v1/wallet-scans/resolve`：受信任掃描端解析動態 QR；需要獨立掃描憑證。
- `GET /v1/courses`：公開課程／場次列表。
- `GET /v1/courses/my`：會員已報名課程。
- `POST /v1/course-sessions/{id}/register`：會員報名場次。
- `POST /v1/course-sessions/{id}/check-in`：實體或線上場次簽到；由場次模式、時間窗與短效 code 驗證。
- `GET /v1/daily-ad`：取得當日輪播廣告與觀看／簽到進度。
- `POST /v1/daily-ad/view-sessions`：開始觀看素材，取得短效觀看 session。
- `POST /v1/daily-ad/view-sessions/{token}/progress`：回報可驗證的觀看進度。
- `POST /v1/daily-ad/check-in`：達到廣告輪播門檻後進行每日簽到。
- `POST /v1/invite-links`：登入會員建立安全邀約連結。
- `GET /i/{inviteToken}`：邀約入口，帶著 token 回到登入頁並提供 OA 導流網址。
- `migrations/0001_member_crm_foundation.sql`：會員、LINE Identity、邀約、直接介紹關係與稽核資料表。
- `migrations/0002_points_ledger_foundation.sql`：可設定規則的點數帳戶與不可變更 Ledger。
- `migrations/0003_courses_and_attendance.sql`：課程、場次、報名、簽到嘗試與有效出席紀錄。
- `migrations/0004_daily_ad_checkin.sql`：圖片／影片輪播活動、觀看 session、有效觀看與每日簽到。
- `migrations/0005_wallet_qr.sql`：動態點數錢包 QR token 與掃描稽核。

## 會員前台

`public/` 是手機優先的會員中心。它提供 LINE Login、OA 導流、邀約分享、點數錢包與動態 QR、公開課程、每日輪播簽到、會員資料編輯。Worker 以 Cloudflare Static Assets 提供前台，API 仍由 Worker 處理。

`/admin.html` 為輕量管理頁。登入會員的 LINE subject 必須列在 `ADMIN_LINE_SUBJECTS` 才可進入管理 API；可建立點數規則、課程與輪播活動／素材。

點數規則在第一版預設為 `draft`，不會自行猜測商業點數。管理後台建立後，才將規則設為 `active`。

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 create mirabeauty_member_crm
# 將回傳的 database_id 取代 wrangler.jsonc 內的全零預設值
npx wrangler d1 migrations apply mirabeauty_member_crm --local
npm test
npx wrangler dev
```

## Deployment configuration

在 Cloudflare Worker 設定以下 secrets／variables：

- `LINE_LOGIN_CHANNEL_ID`
- `SESSION_SIGNING_SECRET`（長隨機字串，使用 secret）
- `DB` D1 binding

本 repo 不儲存 LINE Channel Secret、LINE Access Token、Session Secret 或任何正式 D1 ID。
