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
import { awardPoints, getWallet } from "./points.js";
import {
  cancelCalendarSession,
  checkInToSession,
  smartCheckInToActiveSession,
  listAdminCourses,
  listCalendarSessions,
  listMyCourseSessions,
  listPublicCourseSessions,
  registerForSession,
  saveCalendarSession,
} from "./courses.js";
import {
  checkInDailyAd,
  getDailyAdCampaign,
  listDailyAdCampaigns,
  recordAdViewProgress,
  startAdView,
} from "./daily-ad.js";
import { issueWalletToken, resolveWalletToken } from "./wallet-qr.js";
import { getMyCard, getPublicCard, saveMyCard } from "./cards.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const POINT_RULE_EVENTS = new Set([
  'member_joined',
  'registration_completed',
  'daily_ad_checkin',
  'share_referral',
  'course_registered',
  'attendance_verified',
  'task_completed',
]);

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

function normalizeTemplateImageUrl(value) {
  return String(value || "").replace(
    "/assets/checkin-template/",
    "/v1/checkin-template/images/",
  );
}

function courseCheckinCompactLiffHtml(env, origin) {
  const liffId = String(env.CHECKIN_LIFF_ID || "");
  const apiOrigin = String(origin || "");
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>課程報到</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root{--ink:#2d1d22;--muted:#8f7a82;--rose:#b96072;--soft:#f9edf0;--ok:#0c9f57}
    *{box-sizing:border-box}html,body{min-height:100%;margin:0;background:#fff;color:var(--ink);font-family:"Noto Sans TC",system-ui,sans-serif}
    body{display:grid;place-items:center;padding:24px;padding-top:calc(24px + env(safe-area-inset-top));padding-bottom:calc(24px + env(safe-area-inset-bottom))}
    main{width:min(300px,100%);text-align:center}.spinner{width:34px;height:34px;margin:0 auto 18px;border:4px solid #f5dfe5;border-top-color:var(--rose);border-radius:50%;animation:spin .8s linear infinite}.mark{display:none;width:64px;height:64px;margin:0 auto 18px;border-radius:20px;background:var(--soft);color:var(--rose);place-items:center;font-size:30px;font-weight:900}.mark.show{display:grid}.success .mark{background:#e8f8ef;color:var(--ok)}h1{margin:0;font-size:22px;line-height:1.35}p{margin:10px 0 0;color:var(--muted);font-size:15px;line-height:1.65}.error h1{color:var(--rose)}@keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body><main id="app"><div id="spinner" class="spinner"></div><div id="mark" class="mark">✓</div><h1 id="title">正在確認課程報到</h1><p id="message">核對會員資格、報名紀錄與報到時間…</p></main>
<script>
  const LIFF_ID=${JSON.stringify(liffId)};
  const API_ORIGIN=${JSON.stringify(apiOrigin)};
  const title=document.querySelector("#title"), message=document.querySelector("#message"), spinner=document.querySelector("#spinner"), mark=document.querySelector("#mark"), app=document.querySelector("#app");
  const show=(heading,detail,type="")=>{title.textContent=heading;message.textContent=detail||"";spinner.style.display="none";mark.classList.add("show");app.className=type;};
  const close=()=>setTimeout(()=>{try{if(liff.isInClient())liff.closeWindow();else window.close();}catch(_){window.close();}},2400);
  // LIFF OAuth 回跳時網址會帶 liff.state / code；絕不可再拿原網址登入，
  // 否則會將舊 code 重複兌換，造成 LIFF 開關循環。
  const cleanCheckinRedirect=()=>{
    const url=new URL(location.href);
    ["code","state","scope","error","error_description","liff.state","liff.referrer"].forEach((key)=>url.searchParams.delete(key));
    url.searchParams.set("smartCheckin","1");
    return url.toString();
  };
  (async()=>{
    try{
      await liff.init({liffId:LIFF_ID});
      if(!liff.isLoggedIn()){
        // 一次回跳後仍沒有登入態時停在結果頁，不再自動重導而陷入循環。
        if(sessionStorage.getItem("mirabeauty_compact_checkin_login")==="1"){
          sessionStorage.removeItem("mirabeauty_compact_checkin_login");
          throw new Error("LINE 登入未完成，請關閉後重新掃描報到 QR Code");
        }
        sessionStorage.setItem("mirabeauty_compact_checkin_login","1");
        liff.login({redirectUri:cleanCheckinRedirect()});return;
      }
      sessionStorage.removeItem("mirabeauty_compact_checkin_login");
      const profile=await liff.getProfile().catch(()=>null);
      const auth=await fetch(API_ORIGIN+"/v1/auth/line/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken:liff.getIDToken(),accessToken:liff.getAccessToken()||"",pictureUrl:profile?.pictureUrl||"",displayName:profile?.displayName||""})});
      const identity=await auth.json().catch(()=>({}));
      if(!auth.ok||!identity.sessionToken)throw new Error(identity.error||"LINE 身份驗證失敗");
      const checkin=await fetch(API_ORIGIN+"/v1/course-sessions/smart-check-in",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+identity.sessionToken},body:"{}"});
      const result=await checkin.json().catch(()=>({}));
      if(!checkin.ok)throw new Error(({no_active_session:"目前沒有可報到的活動，請確認時間。",registration_required:"尚未報名本場活動，無法報到。",session_unavailable:"此活動目前無法報到。"}[result.error])||result.error||"報到失敗");
      show(result.duplicate?"本課程已完成報到":"課程報到成功",result.duplicate?"你已完成本場簽到。":"已核對報名與報到時間，簽到點數將依規則入帳。","success");close();
    }catch(error){show("暫時無法完成報到",error.message||"請稍後再試","error");}
  })();
</script></body></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}

async function app(request, env) {
  const url = new URL(request.url);
  const publicCardPath = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)$/);
  if (request.method === "GET" && publicCardPath) {
    return Response.redirect(`${url.origin}/?publicCard=${encodeURIComponent(publicCardPath[1])}`, 302);
  }
  if (request.method === "GET" && (url.pathname === "/r/checkin" || url.pathname === "/r/course-checkin")) {
    // Same two-step Compact LIFF pattern as MLM:
    // QR -> LIFF -> this endpoint with liff.state -> compact verification screen.
    // LIFF 初次開啟帶 liff.state；LINE Login OAuth 回跳則帶 code/state。
    // 兩種都必須回到 Compact 頁交給 liff.init 消耗 code，不能再 redirect 回
    // liff.line.me，否則會在 LIFF 與登入頁之間無限循環。
    if (
      env.CHECKIN_LIFF_ID &&
      (url.searchParams.get("smartCheckin") === "1" ||
        url.searchParams.has("liff.state") ||
        (url.searchParams.has("code") && url.searchParams.has("state")))
    ) {
      return courseCheckinCompactLiffHtml(env, url.origin);
    }
    const liffId = env.CHECKIN_LIFF_ID || env.LIFF_ID;
    const target = liffId
      ? `https://liff.line.me/${encodeURIComponent(liffId)}?smartCheckin=1`
      : `${url.origin}/?smartCheckin=1`;
    return Response.redirect(target, 302);
  }
  const templateImage = url.pathname.match(/^\/(?:assets\/checkin-template|v1\/checkin-template\/images)\/([^/]+)$/);
  if (request.method === "GET" && templateImage) {
    const row = await env.DB.prepare("SELECT content_type, bytes FROM checkin_template_images WHERE id = ?").bind(templateImage[1]).first();
    if (!row?.bytes) return new Response("Not found", { status: 404 });
    const imageBytes = row.bytes instanceof Uint8Array
      ? row.bytes
      : new Uint8Array(row.bytes);
    return new Response(imageBytes, {
      headers: {
        "content-type": row.content_type || "application/octet-stream",
        "content-length": String(imageBytes.byteLength),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const cardMedia = url.pathname.match(/^\/v1\/cards\/media\/([^/]+)$/);
  if (request.method === "GET" && cardMedia) {
    const row = await env.DB.prepare("SELECT content_type, bytes FROM personal_card_media WHERE id = ?").bind(cardMedia[1]).first();
    if (!row?.bytes) return new Response("Not found", { status: 404 });
    const imageBytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes);
    return new Response(imageBytes, { headers: { "content-type": row.content_type || "application/octet-stream", "content-length": String(imageBytes.byteLength), "cache-control": "public, max-age=31536000, immutable" } });
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
      checkinLiffId: env.CHECKIN_LIFF_ID || "",
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
    if (result.created) {
      await awardPoints(env.DB, {
        userId: result.member.userId,
        eventType: "member_joined",
        eventReference: result.member.userId,
        idempotencyKey: `member_joined:${result.member.userId}`,
      });
    }
    if (result.referralCreated && result.member.systemReferrer?.userId) {
      await awardPoints(env.DB, {
        userId: result.member.systemReferrer.userId,
        eventType: "share_referral",
        eventReference: result.member.userId,
        idempotencyKey: `share_referral:${result.member.userId}`,
        metadata: { referredUserId: result.member.userId },
      });
    }
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

  if (request.method === "GET" && url.pathname === "/v1/cards/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    return json({ success: true, card: await getMyCard(env.DB, member.userId) });
  }

  if (["POST", "PUT"].includes(request.method) && url.pathname === "/v1/cards/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const card = await saveMyCard(env.DB, member.userId, (await readJson(request)) || {}, member);
      return json({ success: true, card }, card?.createdAt ? 200 : 201);
    } catch (error) {
      return badRequest(error.message || "Unable to save card");
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/admin/calendar/upload-image") {
    const admin = await currentAdmin(request, env);
    if (!admin) return json({ success: false, error: "Administrator access required" }, 403);
    try {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return badRequest("請選擇活動圖片");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return badRequest("僅支援 JPEG、PNG、WebP 或 GIF");
      // 瀏覽器端會先壓縮；保留足夠上限避免把可處理的原始檔直接擋掉。
      if (file.size > 10 * 1024 * 1024) return badRequest("圖片超過 10MB，請改用較小圖片");
      const id = newId("calendar_media");
      await env.DB.prepare("INSERT INTO personal_card_media (id, platform_user_id, content_type, bytes) VALUES (?, ?, ?, ?)")
        .bind(id, admin.userId, file.type, await file.arrayBuffer()).run();
      return json({ success: true, url: `${url.origin}/v1/cards/media/${id}`, size: file.size }, 201);
    } catch (error) { return badRequest(error.message || "活動圖片上傳失敗"); }
  }

  if (request.method === "POST" && url.pathname === "/v1/cards/me/media") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return badRequest("請選擇圖片檔案");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return badRequest("僅支援 JPEG、PNG、WebP 或 GIF");
      const id = newId("card_media");
      await env.DB.prepare("INSERT INTO personal_card_media (id, platform_user_id, content_type, bytes) VALUES (?, ?, ?, ?)").bind(id, member.userId, file.type, await file.arrayBuffer()).run();
      return json({ success: true, url: `${url.origin}/v1/cards/media/${id}`, size: file.size }, 201);
    } catch (error) { return badRequest(error.message || "圖片上傳失敗"); }
  }

  const publicCardMatch = url.pathname.match(/^\/v1\/cards\/([^/]+)\/public$/);
  if (request.method === "GET" && publicCardMatch) {
    const card = await getPublicCard(env.DB, decodeURIComponent(publicCardMatch[1]));
    return card ? json({ success: true, card }) : json({ success: false, error: "名片不存在或尚未公開" }, 404);
  }

  if (request.method === "PATCH" && url.pathname === "/v1/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const wasCompleted = Boolean(member.profileCompletedAt);
      const updated = await updateMemberProfile(
        env.DB,
        member.userId,
        (await readJson(request)) || {},
      );
      if (!wasCompleted) {
        await awardPoints(env.DB, {
          userId: member.userId,
          eventType: "registration_completed",
          eventReference: member.userId,
          idempotencyKey: `registration_completed:${member.userId}`,
        });
      }
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
    if (request.method === "GET" && url.pathname === "/v1/admin/members") {
      const rows = await env.DB.prepare(`
        SELECT pu.id, pu.status, pu.created_at, mp.display_name, mp.picture_url, mp.phone, mp.email,
          mp.gender, mp.member_number, mp.company_member_number, mp.industry, mp.birthday, mp.address, mp.admin_note, mp.profile_completed_at, COALESCE(pa.balance, 0) AS points_balance,
          rr.referrer_user_id, ref_mp.display_name AS referrer_name, ref_mp.member_number AS referrer_member_number
        FROM platform_users pu
        LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
        LEFT JOIN point_accounts pa ON pa.platform_user_id = pu.id AND pa.program_id = 'program_main'
        LEFT JOIN referral_relationships rr ON rr.referred_user_id = pu.id AND rr.status = 'active'
        LEFT JOIN member_profiles ref_mp ON ref_mp.platform_user_id = rr.referrer_user_id
        ORDER BY pu.created_at DESC
        LIMIT 500
      `).all();
      return json({ success: true, members: rows.results || [] });
    }
    const memberDetailMatch = url.pathname.match(/^\/v1\/admin\/members\/([^/]+)$/);
    if (request.method === "GET" && memberDetailMatch) {
      const memberId = memberDetailMatch[1];
      const member = await env.DB.prepare(`
        SELECT pu.id, pu.status, pu.created_at, mp.display_name, mp.picture_url, mp.phone, mp.email,
          mp.gender, mp.member_number, mp.company_member_number, mp.industry, mp.birthday, mp.address, mp.admin_note, mp.profile_completed_at, COALESCE(pa.balance, 0) AS points_balance,
          rr.referrer_user_id, ref_mp.display_name AS referrer_name, ref_mp.member_number AS referrer_member_number
        FROM platform_users pu
        LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
        LEFT JOIN point_accounts pa ON pa.platform_user_id = pu.id AND pa.program_id = 'program_main'
        LEFT JOIN referral_relationships rr ON rr.referred_user_id = pu.id AND rr.status = 'active'
        LEFT JOIN member_profiles ref_mp ON ref_mp.platform_user_id = rr.referrer_user_id
        WHERE pu.id = ?
      `).bind(memberId).first();
      if (!member) return json({ success: false, error: "Member not found" }, 404);
      const [ledger, courses, checkins, referrals] = await env.DB.batch([
        env.DB.prepare("SELECT event_type, event_reference, delta, balance_after, created_at FROM point_ledger_entries WHERE platform_user_id = ? ORDER BY created_at DESC LIMIT 50").bind(memberId),
        env.DB.prepare("SELECT cr.status, cr.source, cr.registered_at, cs.title, cs.starts_at FROM course_registrations cr JOIN course_sessions cs ON cs.id = cr.course_session_id WHERE cr.platform_user_id = ? ORDER BY cr.registered_at DESC LIMIT 30").bind(memberId),
        env.DB.prepare("SELECT business_date, checked_in_at, status FROM daily_checkins WHERE platform_user_id = ? ORDER BY business_date DESC LIMIT 30").bind(memberId),
        env.DB.prepare("SELECT mp.display_name, mp.member_number, rr.created_at FROM referral_relationships rr LEFT JOIN member_profiles mp ON mp.platform_user_id = rr.referred_user_id WHERE rr.referrer_user_id = ? AND rr.status = 'active' ORDER BY rr.created_at DESC LIMIT 30").bind(memberId),
      ]);
      return json({ success: true, member, ledger: ledger.results || [], courses: courses.results || [], checkins: checkins.results || [], referrals: referrals.results || [] });
    }
    if (request.method === "PATCH" && memberDetailMatch) {
      const memberId = memberDetailMatch[1];
      const body = (await readJson(request)) || {};
      const displayName = String(body.displayName || "").trim().slice(0, 120);
      const phone = String(body.phone || "").trim().slice(0, 40);
      const companyMemberNumber = String(body.companyMemberNumber || "").trim().slice(0, 80);
      const gender = ["", "female", "male", "other", "prefer_not_to_say"].includes(String(body.gender || "")) ? String(body.gender || "") : "";
      const industry = String(body.industry || "").trim().slice(0, 120);
      const birthday = String(body.birthday || "").trim().slice(0, 10);
      const address = String(body.address || "").trim().slice(0, 300);
      const adminNote = String(body.adminNote || "").trim().slice(0, 3000);
      if (!displayName || !companyMemberNumber) return badRequest("姓名與公司會員編號為必填");
      if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return badRequest("生日格式必須為 YYYY-MM-DD");
      const exists = await env.DB.prepare("SELECT platform_user_id FROM member_profiles WHERE platform_user_id = ?").bind(memberId).first();
      if (!exists) return json({ success: false, error: "Member not found" }, 404);
      const duplicate = await env.DB.prepare("SELECT platform_user_id FROM member_profiles WHERE company_member_number = ? AND platform_user_id <> ?").bind(companyMemberNumber, memberId).first();
      if (duplicate) return badRequest("公司會員編號已被其他會員使用");
      const referrerUserId = String(body.referrerUserId || "").trim();
      if (referrerUserId === memberId) return badRequest("推薦人不可為本人");
      if (referrerUserId) {
        const referrer = await env.DB.prepare("SELECT id FROM platform_users WHERE id = ? AND status = 'active'").bind(referrerUserId).first();
        if (!referrer) return badRequest("找不到推薦人系統 ID");
      }
      try {
        await env.DB.batch([
          env.DB.prepare("UPDATE member_profiles SET display_name = ?, phone = ?, gender = ?, company_member_number = ?, industry = ?, birthday = ?, address = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE platform_user_id = ?").bind(displayName, phone, gender, companyMemberNumber, industry, birthday, address, adminNote, memberId),
          referrerUserId
            ? env.DB.prepare("INSERT INTO referral_relationships (id, referred_user_id, referrer_user_id, invite_link_id) VALUES (?, ?, ?, NULL) ON CONFLICT(referred_user_id) DO UPDATE SET referrer_user_id = excluded.referrer_user_id, invite_link_id = NULL, status = 'active', created_at = CURRENT_TIMESTAMP").bind(newId("referral"), memberId, referrerUserId)
            : env.DB.prepare("DELETE FROM referral_relationships WHERE referred_user_id = ?").bind(memberId),
        ]);
        return json({ success: true });
      } catch (error) { return badRequest(error.message || "Unable to update member"); }
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/checkin-template") {
      const rows = await Promise.all([
        env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_templates'").first(),
        env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_template'").first(),
        env.DB.prepare("SELECT id FROM ad_campaigns WHERE id = 'campaign_daily_template' OR id LIKE 'campaign_daily_template_%' ORDER BY updated_at DESC LIMIT 1").first(),
      ]);
      let templates = [];
      try { templates = rows[0]?.value ? JSON.parse(rows[0].value) : []; } catch { templates = []; }
      if (!Array.isArray(templates) || !templates.length) {
        let legacy = null;
        try { legacy = rows[1]?.value ? JSON.parse(rows[1].value) : null; } catch { legacy = null; }
        if (legacy?.pages) templates = [{ ...legacy, id: "legacy_daily_template", campaignId: rows[2]?.id || "campaign_daily_template" }];
      }
      templates = templates.map((template) => ({
        ...template,
        id: String(template.id || newId("daily_template")),
        campaignId: String(template.campaignId || "campaign_daily_template"),
        pages: (Array.isArray(template.pages) ? template.pages : []).map((page) => ({
          ...page,
          imageUrl: normalizeTemplateImageUrl(page.imageUrl),
        })),
      }));
      return json({ success: true, templates, template: templates[0] || null });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/v1/admin/checkin-template/")) {
      const templateId = decodeURIComponent(url.pathname.slice("/v1/admin/checkin-template/".length));
      const meta = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_templates'").first();
      let templates = [];
      try { templates = meta?.value ? JSON.parse(meta.value) : []; } catch { templates = []; }
      if (!Array.isArray(templates)) templates = [];
      const target = templates.find((item) => String(item.id) === templateId);
      if (!target) return badRequest("找不到此標籤活動");
      if (templates.length <= 1) return badRequest("至少要保留一組簽到活動");
      const remaining = templates.filter((item) => String(item.id) !== templateId);
      const campaignId = String(target.campaignId || "");
      const statements = [
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_templates', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(remaining)),
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_template', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(remaining[0])),
      ];
      if (campaignId) {
        statements.push(
          env.DB.prepare("DELETE FROM ad_creatives WHERE campaign_id = ?").bind(campaignId),
          env.DB.prepare("DELETE FROM ad_campaigns WHERE id = ?").bind(campaignId),
        );
      }
      await env.DB.batch(statements);
      return json({ success: true, templates: remaining });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/checkin-template") {
      const template = (await readJson(request)) || {};
      const pages = Array.isArray(template.pages) ? template.pages.slice(0, 12) : [];
      if (!pages.length) return badRequest("At least one template page is required");
      const templateMetaRows = await Promise.all([
        env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_templates'").first(),
        env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_template'").first(),
        env.DB.prepare("SELECT id FROM ad_campaigns WHERE id = 'campaign_daily_template' OR id LIKE 'campaign_daily_template_%' ORDER BY updated_at DESC LIMIT 1").first(),
      ]);
      let templates = [];
      try { templates = templateMetaRows[0]?.value ? JSON.parse(templateMetaRows[0].value) : []; } catch { templates = []; }
      if (!Array.isArray(templates)) templates = [];
      if (!templates.length) {
        let legacy = null;
        try { legacy = templateMetaRows[1]?.value ? JSON.parse(templateMetaRows[1].value) : null; } catch { legacy = null; }
        if (legacy?.pages) templates = [{ ...legacy, id: "legacy_daily_template", campaignId: templateMetaRows[2]?.id || "campaign_daily_template" }];
      }
      const requestedId = String(template.id || "");
      const previous = templates.find((item) => String(item.id) === requestedId);
      const templateId = previous?.id || newId("daily_template");
      const campaignId = previous?.campaignId || String(template.campaignId || `campaign_daily_template_${templateId}`);
      const safe = {
        id: templateId,
        campaignId,
        active: template.active !== false,
        entryUrl: String(template.entryUrl || "").slice(0, 4096),
        altText: String(template.altText || "今日簽到").slice(0, 300),
        rotationMode: template.rotationMode === "sequential" ? "sequential" : "random",
        pages: pages.map((page) => ({
          imageUrl: normalizeTemplateImageUrl(page.imageUrl).slice(0, 4096), imageLink: String(page.imageLink || "").slice(0, 4096),
          bubbleSize: ["nano","micro","deca","hecto","kilo","mega","giga"].includes(page.bubbleSize) ? page.bubbleSize : "nano",
          imageAspectRatio: /^\d{1,4}:\d{1,4}$/.test(String(page.imageAspectRatio || "")) ? page.imageAspectRatio : "400:600",
          imageAspectMode: page.imageAspectMode === "fit" ? "fit" : "cover",
          buttons: (Array.isArray(page.buttons) ? page.buttons : []).slice(0, 4).map((button) => ({ label: String(button.label || "").slice(0, 80), type: "uri", text: "", uri: String(button.uri || "").slice(0, 4096), color: /^#[0-9a-f]{6}$/i.test(String(button.color || "")) ? String(button.color) : "" })).filter((button) => button.label && button.uri),
        })),
      };
      templates = [...templates.filter((item) => String(item.id) !== templateId), safe];
      const campaignStatus = safe.active ? "active" : "paused";
      const statements = [
        env.DB.prepare("DELETE FROM ad_creatives WHERE campaign_id = ?").bind(campaignId),
        env.DB.prepare("INSERT INTO ad_campaigns (id, name, status, starts_at, ends_at, required_creative_count, rotation_mode) VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z', ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at, required_creative_count = excluded.required_creative_count, rotation_mode = excluded.rotation_mode, updated_at = CURRENT_TIMESTAMP").bind(campaignId, safe.altText, campaignStatus, Math.max(1, safe.pages.length), safe.rotationMode),
      ];
      safe.pages.forEach((page, index) => {
        statements.push(env.DB.prepare("INSERT INTO ad_creatives (id, campaign_id, creative_type, title, media_url, preview_url, target_url, image_link, buttons_json, bubble_size, image_aspect_ratio, image_aspect_mode, required_watch_seconds, required_completion_ratio, display_order, status) VALUES (?, ?, 'image', ?, ?, '', '', ?, ?, ?, ?, ?, 3, 0, ?, ?)").bind(newId("creative_daily_template"), campaignId, safe.altText, page.imageUrl, page.imageLink, JSON.stringify(page.buttons), page.bubbleSize, page.imageAspectRatio, page.imageAspectMode, index, safe.active ? "active" : "archived"));
      });
      statements.push(
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_templates', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(templates)),
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_template', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(safe)),
      );
      await env.DB.batch(statements);
      return json({ success: true, template: safe, templates, campaignId });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/checkin-template/upload-image") {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return badRequest("Image file is required");
      if (file.size > 1024 * 1024) return badRequest("Image must be 1MB or smaller");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return badRequest("Only JPEG, PNG, WebP or GIF is allowed");
      const id = newId("template_image");
      await env.DB.prepare("INSERT INTO checkin_template_images (id, content_type, bytes) VALUES (?, ?, ?)").bind(id, file.type, await file.arrayBuffer()).run();
      return json({ success: true, url: `${url.origin}/v1/checkin-template/images/${id}`, size: file.size }, 201);
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/point-rules") {
      const rules = await env.DB.prepare(`
        SELECT id, event_type, points, award_frequency, status, rule_version, created_at, updated_at
        FROM point_rules WHERE program_id = 'program_main'
        ORDER BY event_type ASC, updated_at DESC
      `).all();
      return json({ success: true, rules: rules.results || [] });
    }
    const body = (await readJson(request)) || {};
    if (request.method === "POST" && url.pathname === "/v1/admin/point-rules/reconcile") {
      const [members, profiles, referrals, checkins, registrations, attendance] = await env.DB.batch([
        env.DB.prepare("SELECT id FROM platform_users WHERE status = 'active'"),
        env.DB.prepare("SELECT platform_user_id FROM member_profiles WHERE profile_completed_at IS NOT NULL AND profile_completed_at != ''"),
        env.DB.prepare("SELECT referrer_user_id, referred_user_id FROM referral_relationships WHERE status = 'active'"),
        env.DB.prepare("SELECT platform_user_id, campaign_id, business_date FROM daily_checkins WHERE status = 'verified'"),
        env.DB.prepare("SELECT platform_user_id, course_session_id FROM course_registrations WHERE status = 'registered'"),
        env.DB.prepare("SELECT platform_user_id, course_session_id, id FROM attendance_records WHERE status = 'verified'"),
      ]);
      const work = [
        ...(members.results || []).map((row) => ({ userId: row.id, eventType: "member_joined", eventReference: row.id, idempotencyKey: `member_joined:${row.id}` })),
        ...(profiles.results || []).map((row) => ({ userId: row.platform_user_id, eventType: "registration_completed", eventReference: row.platform_user_id, idempotencyKey: `registration_completed:${row.platform_user_id}` })),
        ...(referrals.results || []).map((row) => ({ userId: row.referrer_user_id, eventType: "share_referral", eventReference: row.referred_user_id, idempotencyKey: `share_referral:${row.referred_user_id}`, metadata: { referredUserId: row.referred_user_id } })),
        ...(checkins.results || []).map((row) => ({ userId: row.platform_user_id, eventType: "daily_ad_checkin", eventReference: `${row.campaign_id}:${row.business_date}`, idempotencyKey: `daily_ad_checkin:${row.campaign_id}:${row.business_date}:${row.platform_user_id}` })),
        ...(registrations.results || []).map((row) => ({ userId: row.platform_user_id, eventType: "course_registered", eventReference: row.course_session_id, idempotencyKey: `course_registered:${row.course_session_id}:${row.platform_user_id}` })),
        ...(attendance.results || []).map((row) => ({ userId: row.platform_user_id, eventType: "attendance_verified", eventReference: row.course_session_id, idempotencyKey: `attendance_verified:${row.course_session_id}:${row.platform_user_id}`, metadata: { attendanceId: row.id } })),
      ];
      let awarded = 0;
      let skipped = 0;
      for (const award of work) {
        const result = await awardPoints(env.DB, award);
        if (result.awarded) awarded += 1;
        else skipped += 1;
      }
      return json({ success: true, awarded, skipped, checked: work.length });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/point-rules") {
      const eventType = String(body.eventType || "").trim();
      const points = Number(body.points);
      if (!POINT_RULE_EVENTS.has(eventType) || !Number.isInteger(points) || points < 0)
        return badRequest("Invalid point rule");
      const frequency = ['once', 'daily', 'per_completion'].includes(body.awardFrequency)
        ? body.awardFrequency : 'per_completion';
      const fixedFrequency = ['member_joined', 'registration_completed'].includes(eventType) ? 'once' : frequency;
      const ruleId = newId("pointrule");
      await env.DB.prepare(
        `INSERT INTO point_rules (id, program_id, event_type, points, daily_limit, award_frequency, status, rule_version) VALUES (?, 'program_main', ?, ?, NULL, ?, ?, ?)`,
      )
        .bind(
          ruleId,
          eventType,
          points,
          fixedFrequency,
          body.status || "draft",
          body.ruleVersion || "v1",
        )
        .run();
      return json({ success: true, id: ruleId }, 201);
    }
    const ruleMatch = url.pathname.match(/^\/v1\/admin\/point-rules\/([^/]+)$/);
    if (request.method === "POST" && ruleMatch) {
      const eventType = String(body.eventType || "").trim();
      const points = Number(body.points);
      if (!POINT_RULE_EVENTS.has(eventType) || !Number.isInteger(points) || points < 0) return badRequest("Invalid point rule");
      const frequency = ['once', 'daily', 'per_completion'].includes(body.awardFrequency)
        ? body.awardFrequency : 'per_completion';
      const fixedFrequency = ['member_joined', 'registration_completed'].includes(eventType) ? 'once' : frequency;
      const status = ['draft', 'active', 'paused', 'archived'].includes(body.status) ? body.status : 'draft';
      const result = await env.DB.prepare(`
        UPDATE point_rules
        SET event_type = ?, points = ?, award_frequency = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND program_id = 'program_main'
      `).bind(eventType, points, fixedFrequency, status, ruleMatch[1]).run();
      if (!result.meta?.changes) return json({ success: false, error: "Point rule not found" }, 404);
      return json({ success: true, id: ruleMatch[1] });
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
    if (request.method === "GET" && url.pathname === "/v1/admin/courses") {
      return json({ success: true, courses: await listAdminCourses(env.DB) });
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/calendar/events") {
      return json({ success: true, events: await listCalendarSessions(env.DB, { from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '' }) });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/calendar/events") {
      const result = await saveCalendarSession(env.DB, body);
      return result.ok ? json({ success: true, id: result.id }, 201) : badRequest(result.reason);
    }
    const calendarDeleteMatch = url.pathname.match(/^\/v1\/admin\/calendar\/events\/([^/]+)$/);
    if (request.method === "DELETE" && calendarDeleteMatch) {
      const changed = await cancelCalendarSession(env.DB, decodeURIComponent(calendarDeleteMatch[1]));
      return changed ? json({ success: true }) : json({ success: false, error: '活動不存在' }, 404);
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
    const campaignId = String(url.searchParams.get("campaignId") || "");
    const campaigns = await listDailyAdCampaigns(env.DB);
    const dailyAd = await getDailyAdCampaign(env.DB, member.userId, campaignId);
    return dailyAd
      ? json({ success: true, campaigns, ...dailyAd })
      : json({ success: true, campaigns, campaign: null, creatives: [] });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/daily-ad/view-sessions"
  ) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const result = await startAdView(env.DB, member.userId, body.creativeId, String(body.campaignId || ""));
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
    const body = (await readJson(request)) || {};
    const result = await checkInDailyAd(env.DB, member.userId, String(body.campaignId || ""));
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
      String((await readJson(request))?.source || 'member_portal'),
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

  if (request.method === "POST" && url.pathname === "/v1/course-sessions/smart-check-in") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const result = await smartCheckInToActiveSession(env.DB, { userId: member.userId });
    return result.ok ? json({ success: true, ...result }, result.duplicate ? 200 : 201) : badRequest(result.reason);
  }

  if (request.method === "POST" && url.pathname === "/v1/invite-links") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
      const body = (await readJson(request)) || {};
      const token = body.token || randomInviteToken();
      try {
        const invite = await createInviteLink(env.DB, member.userId, token);
      // 必須用 LIFF URL 開啟，才能使用 requestFriendship() 的原生加好友視窗。
      const shareUrl = env.LIFF_ID
        ? `https://liff.line.me/${env.LIFF_ID}?invite=${encodeURIComponent(invite.token)}`
        : `${url.origin}/i/${invite.token}`;
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
    // 舊版 QR 仍導向 LIFF URL，避免被當成一般內嵌瀏覽器開啟。
    const loginUrl = env.LIFF_ID
      ? new URL(`https://liff.line.me/${env.LIFF_ID}`)
      : new URL("/", url.origin);
    loginUrl.searchParams.set("invite", inviteToken);
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
