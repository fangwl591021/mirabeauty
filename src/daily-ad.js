import { sha256 } from "./auth.js";
import { newId } from "./member-repository.js";
import { awardPoints } from "./points.js";

function businessDate(now = new Date()) {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return taipei.toISOString().slice(0, 10);
}

function normalizeTemplateImageUrl(value) {
  return String(value || "").replace(
    "/assets/checkin-template/",
    "/v1/checkin-template/images/",
  );
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function activeCampaigns(db) {
  const result = await db
    .prepare(
      `
    SELECT id, name, required_creative_count, rotation_mode FROM ad_campaigns
    WHERE status = 'active' AND starts_at <= CURRENT_TIMESTAMP AND ends_at >= CURRENT_TIMESTAMP
      AND (id = 'campaign_daily_template' OR id LIKE 'campaign_daily_template_%')
    ORDER BY updated_at DESC, id ASC
  `,
    )
    .all();
  return result.results || [];
}

async function activeCampaign(db, campaignId = "") {
  const campaigns = await activeCampaigns(db);
  if (campaignId) return campaigns.find((campaign) => campaign.id === campaignId) || null;
  return campaigns[0] || null;
}

export async function listDailyAdCampaigns(db) {
  const campaigns = await activeCampaigns(db);
  return campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name || "今日簽到",
    requiredCreativeCount: Number(campaign.required_creative_count || 1),
    rotationMode: campaign.rotation_mode || "sequential",
  }));
}

export async function getDailyAdCampaign(db, userId, campaignId = "") {
  const campaign = await activeCampaign(db, campaignId);
  if (!campaign) return null;
  const creativeResult = await db
    .prepare(
      `
    SELECT id, creative_type, title, media_url, preview_url, target_url, image_link, buttons_json, bubble_size, image_aspect_ratio, image_aspect_mode, required_watch_seconds, required_completion_ratio, display_order
    FROM ad_creatives WHERE campaign_id = ? AND status = 'active' ORDER BY display_order ASC, id ASC
  `,
    )
    .bind(campaign.id)
    .all();
  const date = businessDate();
  const completed = await db
    .prepare(
      `
    SELECT COUNT(*) AS count FROM daily_ad_view_events
    WHERE platform_user_id = ? AND campaign_id = ? AND business_date = ? AND qualified_at IS NOT NULL
  `,
    )
    .bind(userId, campaign.id, date)
    .first();
  const completedCreatives = await db
    .prepare(
      `
    SELECT creative_id FROM daily_ad_view_events
    WHERE platform_user_id = ? AND campaign_id = ? AND business_date = ? AND qualified_at IS NOT NULL
  `,
    )
    .bind(userId, campaign.id, date)
    .all();
  const checkin = await db
    .prepare(
      `
    SELECT id FROM daily_checkins WHERE platform_user_id = ? AND campaign_id = ? AND business_date = ? AND status = 'verified'
  `,
    )
    .bind(userId, campaign.id, date)
    .first();
  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      requiredCreativeCount: campaign.required_creative_count,
      rotationMode: campaign.rotation_mode || "sequential",
    },
    creatives: (creativeResult.results || []).map((creative) => {
      let buttons = [];
      try {
        buttons = JSON.parse(creative.buttons_json || "[]");
      } catch {}
      return {
        ...creative,
        media_url: normalizeTemplateImageUrl(creative.media_url),
        image_link: normalizeTemplateImageUrl(creative.image_link),
        buttons: Array.isArray(buttons) ? buttons.slice(0, 4) : [],
      };
    }),
    businessDate: date,
    qualifiedCreativeCount: Number(completed?.count || 0),
    qualifiedCreativeIds: (completedCreatives.results || []).map(
      (row) => row.creative_id,
    ),
    checkedIn: Boolean(checkin),
  };
}

export async function startAdView(db, userId, creativeId, campaignId = "") {
  const campaign = await activeCampaign(db, campaignId);
  if (!campaign) return { ok: false, reason: "no_active_campaign" };
  const creative = await db
    .prepare(
      `
    SELECT id FROM ad_creatives WHERE id = ? AND campaign_id = ? AND status = 'active'
  `,
    )
    .bind(creativeId, campaign.id)
    .first();
  if (!creative) return { ok: false, reason: "creative_unavailable" };
  const token = randomToken();
  const sessionId = newId("adview");
  await db
    .prepare(
      `
    INSERT INTO ad_view_sessions (id, token_hash, platform_user_id, campaign_id, creative_id, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))
  `,
    )
    .bind(sessionId, await sha256(token), userId, campaign.id, creative.id)
    .run();
  return { ok: true, token, expiresIn: 600 };
}

export async function recordAdViewProgress(
  db,
  {
    userId,
    token,
    watchedSeconds,
    completionRatio,
    pageVisible = true,
    now = Date.now(),
  },
) {
  const session = await db
    .prepare(
      `
    SELECT avs.id, avs.campaign_id, avs.creative_id, avs.started_at, avs.expires_at, avs.observed_seconds, avs.completion_ratio,
      ac.required_watch_seconds, ac.required_completion_ratio
    FROM ad_view_sessions avs JOIN ad_creatives ac ON ac.id = avs.creative_id
    WHERE avs.token_hash = ? AND avs.platform_user_id = ? AND avs.status IN ('active', 'qualified')
  `,
    )
    .bind(await sha256(String(token || "")), userId)
    .first();
  if (!session || Date.parse(session.expires_at) < now)
    return { ok: false, reason: "view_session_expired" };
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - Date.parse(session.started_at)) / 1000),
  );
  const reportedSeconds = Math.max(0, Math.floor(Number(watchedSeconds) || 0));
  const nextSeconds = pageVisible
    ? Math.max(
        Number(session.observed_seconds),
        Math.min(reportedSeconds, elapsedSeconds),
      )
    : Number(session.observed_seconds);
  const nextRatio = pageVisible
    ? Math.max(
        Number(session.completion_ratio),
        Math.min(1, Math.max(0, Number(completionRatio) || 0)),
      )
    : Number(session.completion_ratio);
  const qualified =
    nextSeconds >= Number(session.required_watch_seconds) &&
    nextRatio >= Number(session.required_completion_ratio);
  await db
    .prepare(
      `
    UPDATE ad_view_sessions SET observed_seconds = ?, completion_ratio = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `,
    )
    .bind(
      nextSeconds,
      nextRatio,
      qualified ? "qualified" : "active",
      session.id,
    )
    .run();
  if (qualified) {
    const date = businessDate(new Date(now));
    await db
      .prepare(
        `
      INSERT INTO daily_ad_view_events (id, platform_user_id, campaign_id, creative_id, business_date, view_session_id, observed_seconds, completion_ratio, qualified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(platform_user_id, campaign_id, creative_id, business_date) DO UPDATE SET
        observed_seconds = MAX(observed_seconds, excluded.observed_seconds),
        completion_ratio = MAX(completion_ratio, excluded.completion_ratio),
        qualified_at = COALESCE(daily_ad_view_events.qualified_at, excluded.qualified_at),
        updated_at = CURRENT_TIMESTAMP
    `,
      )
      .bind(
        newId("adviewevent"),
        userId,
        session.campaign_id,
        session.creative_id,
        date,
        session.id,
        nextSeconds,
        nextRatio,
      )
      .run();
  }
  return {
    ok: true,
    qualified,
    observedSeconds: nextSeconds,
    completionRatio: nextRatio,
  };
}

export async function checkInDailyAd(db, userId, campaignId = "") {
  const campaign = await activeCampaign(db, campaignId);
  if (!campaign) return { ok: false, reason: "no_active_campaign" };
  const date = businessDate();
  const alreadyCheckedIn = await db
    .prepare(
      "SELECT id FROM daily_checkins WHERE platform_user_id = ? AND campaign_id = ? AND business_date = ? AND status = 'verified' LIMIT 1",
    )
    .bind(userId, campaign.id, date)
    .first();
  if (alreadyCheckedIn) {
    // 舊版可能先寫入簽到紀錄但因每日上限 bug 未寫點數。
    // 再次確認時以同一冪等鍵補發；已有帳務紀錄則安全地不重複加點。
    const pointResult = await awardPoints(db, {
      userId,
      eventType: "daily_ad_checkin",
      eventReference: `${campaign.id}:${date}`,
      idempotencyKey: `daily_ad_checkin:${campaign.id}:${date}:${userId}`,
      metadata: { checkinId: alreadyCheckedIn.id, campaignId: campaign.id, reconciled: true },
    });
    return { ok: true, duplicate: true, checkinId: alreadyCheckedIn.id, pointResult };
  }
  const qualifying = await db
    .prepare(
      `
    SELECT COUNT(*) AS count FROM daily_ad_view_events
    WHERE platform_user_id = ? AND campaign_id = ? AND business_date = ? AND qualified_at IS NOT NULL
  `,
    )
    .bind(userId, campaign.id, date)
    .first();
  if (
    Number(qualifying?.count || 0) < Number(campaign.required_creative_count)
  ) {
    return {
      ok: false,
      reason: "watch_requirement_not_met",
      qualifiedCreativeCount: Number(qualifying?.count || 0),
    };
  }
  const checkinId = newId("dailycheckin");
  try {
    await db
      .prepare(
        `INSERT INTO daily_checkins (id, platform_user_id, campaign_id, business_date) VALUES (?, ?, ?, ?)`,
      )
      .bind(checkinId, userId, campaign.id, date)
      .run();
  } catch (error) {
    if (
      String(error.message || "").includes(
        "UNIQUE constraint failed: daily_checkins.platform_user_id, daily_checkins.campaign_id, daily_checkins.business_date",
      )
    ) {
      return { ok: true, duplicate: true };
    }
    throw error;
  }
  const pointResult = await awardPoints(db, {
    userId,
    eventType: "daily_ad_checkin",
    eventReference: `${campaign.id}:${date}`,
    idempotencyKey: `daily_ad_checkin:${campaign.id}:${date}:${userId}`,
    metadata: { checkinId, campaignId: campaign.id },
  });
  return { ok: true, duplicate: false, checkinId, pointResult };
}
