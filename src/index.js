import {
  createSession,
  sha256,
  verifyLineAccessToken,
  verifyLineIdToken,
  verifySession,
} from "./auth.js";
import {
  createInviteLink,
  getMember,
  isAdminMember,
  newId,
  resolveLineMember,
  updateMemberProfile,
} from "./member-repository.js";
import { getWallet } from "./points.js";
import {
  checkInToSession,
  listMyCourseSessions,
  listPublicCourseSessions,
  registerForSession,
} from "./courses.js";
import {
  checkInDailyAd,
  getDailyAdCampaign,
  recordAdViewProgress,
  startAdView,
} from "./daily-ad.js";
import { issueWalletToken, resolveWalletToken } from "./wallet-qr.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function badRequest(message) {
  return json({ success: false, error: message }, 400);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function currentMember(request, env) {
  if (!env.SESSION_SIGNING_SECRET) return null;
  const session = await verifySession(
    bearerToken(request),
    env.SESSION_SIGNING_SECRET,
  );
  if (!session) return null;
  return getMember(env.DB, session.sub);
}

async function currentAdmin(request, env) {
  const member = await currentMember(request, env);
  if (
    !member ||
    !(await isAdminMember(env.DB, member.userId, env.ADMIN_LINE_SUBJECTS))
  )
    return null;
  return member;
}

function randomInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function app(request, env) {
  const url = new URL(request.url);
  const templateImage = url.pathname.match(/^\/assets\/checkin-template\/([^/]+)$/);
  if (request.method === "GET" && templateImage) {
    const row = await env.DB.prepare("SELECT content_type, bytes FROM checkin_template_images WHERE id = ?").bind(templateImage[1]).first();
    return row ? new Response(row.bytes, { headers: { "content-type": row.content_type, "cache-control": "public, max-age=31536000, immutable" } }) : new Response("Not found", { status: 404 });
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      success: true,
      service: "mirabeauty-member-crm",
      version: "0.1.0",
    });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return json({
      success: true,
      liffId: env.LIFF_ID || "",
      officialAccountUrl: "https://lin.ee/sV9xDLr",
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/line/verify") {
    if (!env.DB || !env.LINE_LOGIN_CHANNEL_ID || !env.SESSION_SIGNING_SECRET)
      return json({ success: false, error: "Service is not configured" }, 503);
    const body = await readJson(request);
    if (!body?.idToken && !body?.accessToken)
      return badRequest("LINE token is required");
    const lineProfile = (await verifyLineIdToken(
      body.idToken,
      env.LINE_LOGIN_CHANNEL_ID,
    )) || await verifyLineAccessToken(body.accessToken);
    if (!lineProfile)
      return json({ success: false, error: "Invalid LINE ID token" }, 401);
    const result = await resolveLineMember(env.DB, {
      ...lineProfile,
      picture: String(body.pictureUrl || lineProfile.picture || ""),
      name: String(body.displayName || lineProfile.name || ""),
    }, body.inviteToken);
    if (result.member.status !== "active")
      return json({ success: false, error: "Member is unavailable" }, 403);
    const sessionToken = await createSession(
      result.member.userId,
      env.SESSION_SIGNING_SECRET,
    );
    return json(
      { success: true, ...result, sessionToken, expiresIn: 604800 },
      result.created ? 201 : 200,
    );
  }

  if (request.method === "GET" && url.pathname === "/v1/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    return json({ success: true, member });
  }

  if (request.method === "PATCH" && url.pathname === "/v1/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const updated = await updateMemberProfile(
        env.DB,
        member.userId,
        (await readJson(request)) || {},
      );
      return json({ success: true, member: updated });
    } catch (error) {
      return badRequest(error.message || "Unable to save profile");
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/points/wallet") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    return json({
      success: true,
      wallet: await getWallet(env.DB, member.userId),
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/points/wallet/qr") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    try {
      const walletToken = await issueWalletToken(
        env.DB,
        member.userId,
        body.purpose || "member_identification",
      );
      return json(
        {
          success: true,
          ...walletToken,
          qrPayload: `${url.origin}/w/${walletToken.token}`,
        },
        201,
      );
    } catch (error) {
      return badRequest(error.message || "Unable to issue wallet QR");
    }
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/wallet-scans/resolve"
  ) {
    const scannerKey = request.headers.get("x-wallet-scanner-key") || "";
    if (
      !env.WALLET_SCANNER_API_KEY ||
      scannerKey !== env.WALLET_SCANNER_API_KEY
    )
      return json({ success: false, error: "Unauthorized scanner" }, 401);
    const body = (await readJson(request)) || {};
    const result = await resolveWalletToken(
      env.DB,
      body.token,
      body.scannerLabel || "",
    );
    return result.ok
      ? json({ success: true, ...result })
      : json({ success: false, error: result.reason }, 400);
  }

  if (url.pathname.startsWith("/v1/admin/")) {
    const admin = await currentAdmin(request, env);
    if (!admin)
      return json(
        { success: false, error: "Administrator access required" },
        403,
      );
    if (request.method === "GET" && url.pathname === "/v1/admin/overview") {
      const [members, courses, campaigns, points, checkins] =
        await env.DB.batch([
          env.DB.prepare(
            "SELECT COUNT(*) AS count FROM platform_users WHERE status = 'active'",
          ),
          env.DB.prepare(
            "SELECT COUNT(*) AS count FROM courses WHERE status = 'published'",
          ),
          env.DB.prepare(
            "SELECT COUNT(*) AS count FROM ad_campaigns WHERE status = 'active'",
          ),
          env.DB.prepare(
            "SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS count FROM point_ledger_entries",
          ),
          env.DB.prepare(
            "SELECT COUNT(*) AS count FROM daily_checkins WHERE status = 'verified'",
          ),
        ]);
      return json({
        success: true,
        overview: {
          members: Number(members.results[0].count),
          publishedCourses: Number(courses.results[0].count),
          activeCampaigns: Number(campaigns.results[0].count),
          issuedPoints: Number(points.results[0].count),
          verifiedCheckins: Number(checkins.results[0].count),
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/checkin-template") {
      const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_template'").first();
      let template = null;
      try { template = row?.value ? JSON.parse(row.value) : null; } catch { template = null; }
      return json({ success: true, template });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/checkin-template") {
      const template = (await readJson(request)) || {};
      const pages = Array.isArray(template.pages) ? template.pages.slice(0, 12) : [];
      if (!pages.length) return badRequest("At least one template page is required");
      const safe = {
        active: template.active !== false,
        entryUrl: String(template.entryUrl || "").slice(0, 4096),
        altText: String(template.altText || "簽到贈點活動").slice(0, 300),
        rotationMode: template.rotationMode === "sequential" ? "sequential" : "random",
        pages: pages.map((page) => ({
          imageUrl: String(page.imageUrl || "").slice(0, 4096), imageLink: String(page.imageLink || "").slice(0, 4096),
          bubbleSize: ["nano","micro","deca","hecto","kilo","mega","giga"].includes(page.bubbleSize) ? page.bubbleSize : "nano",
          imageAspectRatio: /^\d{1,4}:\d{1,4}$/.test(String(page.imageAspectRatio || "")) ? page.imageAspectRatio : "400:600",
          imageAspectMode: page.imageAspectMode === "fit" ? "fit" : "cover",
          buttons: (Array.isArray(page.buttons) ? page.buttons : []).slice(0, 4).map((button) => ({ label: String(button.label || "").slice(0, 80), type: button.type === "uri" ? "uri" : "message", text: String(button.text || "").slice(0, 300), uri: String(button.uri || "").slice(0, 4096), color: /^#[0-9a-f]{6}$/i.test(String(button.color || "")) ? String(button.color) : "" })),
        })),
      };
      const campaignId = "campaign_daily_template";
      const campaignStatus = safe.active ? "active" : "paused";
      const statements = [
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_template', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(safe)),
        env.DB.prepare("INSERT INTO ad_campaigns (id, name, status, starts_at, ends_at, required_creative_count, rotation_mode) VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z', ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, required_creative_count = excluded.required_creative_count, rotation_mode = excluded.rotation_mode, updated_at = CURRENT_TIMESTAMP").bind(campaignId, safe.altText, campaignStatus, Math.max(1, safe.pages.length), safe.rotationMode),
        env.DB.prepare("UPDATE ad_creatives SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ?").bind(campaignId),
      ];
      safe.pages.forEach((page, index) => {
        statements.push(env.DB.prepare("INSERT INTO ad_creatives (id, campaign_id, creative_type, title, media_url, preview_url, target_url, image_link, buttons_json, bubble_size, image_aspect_ratio, image_aspect_mode, required_watch_seconds, required_completion_ratio, display_order, status) VALUES (?, ?, 'image', ?, ?, '', '', ?, ?, ?, ?, ?, 3, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, media_url = excluded.media_url, image_link = excluded.image_link, buttons_json = excluded.buttons_json, bubble_size = excluded.bubble_size, image_aspect_ratio = excluded.image_aspect_ratio, image_aspect_mode = excluded.image_aspect_mode, display_order = excluded.display_order, status = excluded.status, updated_at = CURRENT_TIMESTAMP").bind(`creative_daily_template_${index + 1}`, campaignId, safe.altText, page.imageUrl, page.imageLink, JSON.stringify(page.buttons), page.bubbleSize, page.imageAspectRatio, page.imageAspectMode, index, safe.active ? "active" : "archived"));
      });
      await env.DB.batch(statements);
      return json({ success: true, template: safe, campaignId });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/checkin-template/upload-image") {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return badRequest("Image file is required");
      if (file.size > 1024 * 1024) return badRequest("Image must be 1MB or smaller");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return badRequest("Only JPEG, PNG, WebP or GIF is allowed");
      const id = newId("template_image");
      await env.DB.prepare("INSERT INTO checkin_template_images (id, content_type, bytes) VALUES (?, ?, ?)").bind(id, file.type, await file.arrayBuffer()).run();
      return json({ success: true, url: `${url.origin}/assets/checkin-template/${id}`, size: file.size }, 201);
    }
    const body = (await readJson(request)) || {};
    if (request.method === "POST" && url.pathname === "/v1/admin/point-rules") {
      const eventType = String(body.eventType || "").trim();
      const points = Number(body.points);
      if (!eventType || !Number.isInteger(points) || points < 0)
        return badRequest("Invalid point rule");
      const ruleId = newId("pointrule");
      await env.DB.prepare(
        `INSERT INTO point_rules (id, program_id, event_type, points, daily_limit, status, rule_version) VALUES (?, 'program_main', ?, ?, ?, ?, ?)`,
      )
        .bind(
          ruleId,
          eventType,
          points,
          body.dailyLimit ?? null,
          body.status || "draft",
          body.ruleVersion || "v1",
        )
        .run();
      return json({ success: true, id: ruleId }, 201);
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/courses") {
      const title = String(body.title || "").trim();
      if (!title) return badRequest("title is required");
      const id = newId("course");
      await env.DB.prepare(
        `INSERT INTO courses (id, title, description, cover_url, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          title,
          String(body.description || ""),
          String(body.coverUrl || ""),
          body.status || "draft",
          admin.userId,
        )
        .run();
      return json({ success: true, id }, 201);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/admin/course-sessions"
    ) {
      const required = [
        "courseId",
        "mode",
        "startsAt",
        "endsAt",
        "checkinOpensAt",
        "checkinClosesAt",
      ];
      if (required.some((k) => !body[k]))
        return badRequest("Missing course session fields");
      if (!["physical", "online"].includes(body.mode))
        return badRequest("Invalid mode");
      const id = newId("session");
      const codeHash = body.checkinCode
        ? await sha256(String(body.checkinCode))
        : "";
      await env.DB.prepare(
        `INSERT INTO course_sessions (id, course_id, title, attendance_mode, starts_at, ends_at, venue_name, venue_address, meeting_url, checkin_opens_at, checkin_closes_at, checkin_code_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          body.courseId,
          String(body.title || ""),
          body.mode,
          body.startsAt,
          body.endsAt,
          String(body.venueName || ""),
          String(body.venueAddress || ""),
          String(body.meetingUrl || ""),
          body.checkinOpensAt,
          body.checkinClosesAt,
          codeHash,
        )
        .run();
      return json({ success: true, id }, 201);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/admin/ad-campaigns"
    ) {
      if (!body.name || !body.startsAt || !body.endsAt)
        return badRequest("Missing campaign fields");
      const id = newId("campaign");
      await env.DB.prepare(
        `INSERT INTO ad_campaigns (id, name, status, starts_at, ends_at, required_creative_count, rotation_mode) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          String(body.name),
          body.status || "draft",
          body.startsAt,
          body.endsAt,
          Math.max(1, Number(body.requiredCreativeCount) || 1),
          body.rotationMode === "random" ? "random" : "sequential",
        )
        .run();
      return json({ success: true, id }, 201);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/admin/ad-creatives"
    ) {
      if (
        !body.campaignId ||
        !body.type ||
        !body.mediaUrl ||
        !["image", "video", "article"].includes(body.type)
      )
        return badRequest("Invalid creative");
      const id = newId("creative");
      const buttons = Array.isArray(body.buttons)
        ? body.buttons
            .slice(0, 4)
            .map((button) => ({
              label: String(button.label || "").slice(0, 40),
              type: button.type === "uri" ? "uri" : "message",
              uri: String(button.uri || "").slice(0, 2048),
              text: String(button.text || "").slice(0, 300),
              color: /^#[0-9a-f]{6}$/i.test(String(button.color || ""))
                ? String(button.color)
                : "",
            }))
            .filter((button) => button.label)
        : [];
      await env.DB.prepare(
        `INSERT INTO ad_creatives (id, campaign_id, creative_type, title, media_url, preview_url, target_url, image_link, buttons_json, bubble_size, image_aspect_ratio, image_aspect_mode, required_watch_seconds, required_completion_ratio, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          body.campaignId,
          body.type,
          String(body.title || ""),
          body.mediaUrl,
          String(body.previewUrl || ""),
          String(body.targetUrl || ""),
          String(body.imageLink || ""),
          JSON.stringify(buttons),
          ["nano", "micro", "deca", "hecto", "kilo", "mega", "giga"].includes(
            body.bubbleSize,
          )
            ? body.bubbleSize
            : "nano",
          /^\d{1,4}:\d{1,4}$/.test(String(body.imageAspectRatio || ""))
            ? body.imageAspectRatio
            : "400:600",
          body.imageAspectMode === "fit" ? "fit" : "cover",
          Math.max(0, Number(body.requiredWatchSeconds) || 3),
          Math.min(1, Math.max(0, Number(body.requiredCompletionRatio) || 0)),
          Number(body.displayOrder) || 0,
        )
        .run();
      return json({ success: true, id }, 201);
    }
    return json({ success: false, error: "Admin endpoint not found" }, 404);
  }

  if (request.method === "GET" && url.pathname === "/v1/courses") {
    return json({
      success: true,
      sessions: await listPublicCourseSessions(env.DB),
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/courses/my") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    return json({
      success: true,
      sessions: await listMyCourseSessions(env.DB, member.userId),
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/daily-ad") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const dailyAd = await getDailyAdCampaign(env.DB, member.userId);
    return dailyAd
      ? json({ success: true, ...dailyAd })
      : json({ success: true, campaign: null, creatives: [] });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/daily-ad/view-sessions"
  ) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const result = await startAdView(env.DB, member.userId, body.creativeId);
    return result.ok
      ? json({ success: true, ...result }, 201)
      : badRequest(result.reason);
  }

  const adProgressMatch = url.pathname.match(
    /^\/v1\/daily-ad\/view-sessions\/([^/]+)\/progress$/,
  );
  if (request.method === "POST" && adProgressMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const result = await recordAdViewProgress(env.DB, {
      userId: member.userId,
      token: decodeURIComponent(adProgressMatch[1]),
      watchedSeconds: body.watchedSeconds,
      completionRatio: body.completionRatio,
      pageVisible: body.pageVisible !== false,
    });
    return result.ok
      ? json({ success: true, ...result })
      : badRequest(result.reason);
  }

  if (request.method === "POST" && url.pathname === "/v1/daily-ad/check-in") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const result = await checkInDailyAd(env.DB, member.userId);
    return result.ok
      ? json({ success: true, ...result }, result.duplicate ? 200 : 201)
      : badRequest(result.reason);
  }

  const registrationMatch = url.pathname.match(
    /^\/v1\/course-sessions\/([^/]+)\/register$/,
  );
  if (request.method === "POST" && registrationMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const result = await registerForSession(
      env.DB,
      member.userId,
      decodeURIComponent(registrationMatch[1]),
    );
    return result.ok
      ? json({ success: true, ...result }, result.duplicate ? 200 : 201)
      : badRequest(result.reason);
  }

  const checkinMatch = url.pathname.match(
    /^\/v1\/course-sessions\/([^/]+)\/check-in$/,
  );
  if (request.method === "POST" && checkinMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const result = await checkInToSession(env.DB, {
      userId: member.userId,
      sessionId: decodeURIComponent(checkinMatch[1]),
      method: body.method,
      code: body.code,
    });
    return result.ok
      ? json({ success: true, ...result }, result.duplicate ? 200 : 201)
      : badRequest(result.reason);
  }

  if (request.method === "POST" && url.pathname === "/v1/invite-links") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const token = body.token || randomInviteToken();
    try {
      const invite = await createInviteLink(env.DB, member.userId, token);
      const shareUrl = `${url.origin}/i/${invite.token}`;
      return json(
        {
          success: true,
          invite: {
            id: invite.id,
            token: invite.token,
            url: shareUrl,
            qrPayload: shareUrl,
          },
        },
        201,
      );
    } catch (error) {
      return badRequest(error.message || "Unable to create invite link");
    }
  }

  if (request.method === "GET" && url.pathname.startsWith("/i/")) {
    const inviteToken = decodeURIComponent(url.pathname.slice(3));
    if (!inviteToken || inviteToken.length > 512)
      return new Response("Invalid invite link", { status: 400 });
    const loginUrl = new URL("/", url.origin);
    loginUrl.searchParams.set("invite", inviteToken);
    loginUrl.searchParams.set("oa", "https://lin.ee/sV9xDLr");
    return Response.redirect(loginUrl.toString(), 302);
  }

  if (env.ASSETS) return env.ASSETS.fetch(request);
  return json({ success: false, error: "Not Found" }, 404);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: { allow: "GET, POST, OPTIONS" } });
    try {
      return await app(request, env);
    } catch (error) {
      console.error("Unhandled request error", error);
      return json({ success: false, error: "Internal Server Error" }, 500);
    }
  },
};
