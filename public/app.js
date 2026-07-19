const inviteFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("invite")) return params.get("invite");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("invite") || ""; }
  catch { return ""; }
};
const courseSessionFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("courseSession")) return params.get("courseSession");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("courseSession") || ""; }
  catch { return ""; }
};
const smartCheckinFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("smartCheckin") === "1") return true;
  const liffState = params.get("liff.state");
  if (!liffState) return false;
  try { return new URL(liffState, location.origin).searchParams.get("smartCheckin") === "1"; }
  catch { return false; }
};
const publicCardFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("publicCard")) return params.get("publicCard");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("publicCard") || ""; }
  catch { return ""; }
};
const cardShareIdFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("shareCardId")) return params.get("shareCardId");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("shareCardId") || ""; }
  catch { return ""; }
};
const cardShareModeFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("share") === "1") return true;
  const liffState = params.get("liff.state");
  if (!liffState) return false;
  try { return new URL(liffState, location.origin).searchParams.get("share") === "1"; }
  catch { return false; }
};
const state = {
  config: null,
  token: localStorage.getItem("mirabeauty_session") || "",
  member: null,
  tab: new URLSearchParams(location.search).get("tab") === "daily" ? "daily" : "home",
  invite: inviteFromLocation() || sessionStorage.getItem("mirabeauty_invite") || "",
  courseSession: courseSessionFromLocation() || sessionStorage.getItem("mirabeauty_course_session") || "",
  smartCheckin: smartCheckinFromLocation() || sessionStorage.getItem("mirabeauty_smart_checkin") === "1",
  publicCard: publicCardFromLocation(),
  cardShareId: cardShareIdFromLocation() || sessionStorage.getItem("mirabeauty_card_share_id") || "",
  cardShareMode: cardShareModeFromLocation() || sessionStorage.getItem("mirabeauty_card_share_mode") === "1",
  pendingCardShareId: sessionStorage.getItem("mirabeauty_pending_card_share_id") || "",
  courseView: "catalog",
  cardVersion: "",
  daily: null,
  dailyPanel: "checkin",
  dailyCampaignId: new URLSearchParams(location.search).get("checkin") || "",
};
const $ = (s) => document.querySelector(s);
let dailyRotationTimer = null;
// LIFF 的 OAuth code 僅能兌換一次。整個頁面生命週期只能初始化一次，
// 否則在名片分享時再次 init 會重新使用網址上殘留的 code，導致
// "invalid authorization code" 而無法開啟分享對象選擇器。
let liffInitPromise = null;
function cleanLiffRedirectUrl() {
  const current = new URL(location.href);
  const encodedState = current.searchParams.get("liff.state");
  let redirect = current;
  if (encodedState) {
    try { redirect = new URL(encodedState, location.origin); } catch { /* retain current URL */ }
  }
  ["code", "state", "scope", "error", "error_description", "liff.state", "liff.referrer"].forEach((key) => redirect.searchParams.delete(key));
  return redirect.toString();
}
async function initLiffOnce() {
  if (!state.config?.liffId) throw new Error("尚未設定 LIFF_ID");
  if (!window.liff) throw new Error("LINE LIFF 尚未載入，請從 LINE 重新開啟會員中心");
  if (!liffInitPromise) {
    liffInitPromise = liff.init({ liffId: state.config.liffId }).catch((error) => {
      liffInitPromise = null;
      throw error;
    });
  }
  await liffInitPromise;
}
if (inviteFromLocation()) sessionStorage.setItem("mirabeauty_invite", state.invite);
if (courseSessionFromLocation()) sessionStorage.setItem("mirabeauty_course_session", state.courseSession);
if (smartCheckinFromLocation()) sessionStorage.setItem("mirabeauty_smart_checkin", "1");
if (cardShareIdFromLocation()) sessionStorage.setItem("mirabeauty_card_share_id", state.cardShareId);
if (cardShareModeFromLocation()) sessionStorage.setItem("mirabeauty_card_share_mode", "1");
const pointEventLabel = { member_joined:"加入會員", registration_completed:"完成註冊", share_referral:"分享邀約成功", daily_ad_checkin:"每日簽到", course_registered:"課程報名", attendance_verified:"課程簽到", task_completed:"完成任務" };
const api = async (path, options = {}) => {
  const r = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "操作失敗");
  return j;
};
const esc = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const format = (value) => new Intl.NumberFormat("zh-TW").format(Number(value) || 0);
function avatar(member = state.member) {
  return member?.pictureUrl
    ? `<img class="avatar" src="${esc(member.pictureUrl)}" alt="LINE 頭貼">`
    : `<span class="avatar placeholder">${esc((member?.displayName || "L").slice(0, 1))}</span>`;
}
function layout(body) {
  const featureCopy = { wallet:["點數錢包","查看目前可用點數與交易紀錄。"], courses:["課程活動","查看課程、完成報名與簽到。"], daily:[state.daily?.campaign?.name || "簽到贈點活動",`向左滑動輪播卡；完成 ${Number(state.daily?.campaign?.requiredCreativeCount) || 0} 項觀看後，即可每日簽到。`], card:["我的名片","編輯並分享你的專屬數位名片。"], profile:["會員資料","管理你的會員資料與個人資訊。"] };
  const [featureTitle,featureHint] = featureCopy[state.tab] || ["MiraBeauty 會員中心","會員服務與活動入口。"];
  const featureHeader = `<header class="hero member-hero feature-member-hero"><div class="daily-banner-profile">${avatar()}<strong>${esc(state.member?.displayName || "LINE 會員")}</strong></div><div class="daily-banner-copy"><h1>${esc(featureTitle)}</h1><p>${esc(featureHint)}</p></div></header>`;
  const memberHeader = state.tab === "home" ? "" : featureHeader;
  $("#app").innerHTML =
    `${memberHeader}<div class="content">${state.tab === "home" ? "" : portalMenu()}${body}</div><nav class="nav">${[
      ["home", "首頁"],
      ["wallet", "錢包"],
      ["courses", "課程"],
      ["daily", "每日"],
      ["profile", "我的"],
    ]
      .map(
        ([id, n]) =>
          `<button class="${state.tab === id ? "active" : ""}" data-tab="${id}">${n}</button>`,
      )
      .join("")}</nav>`;
  document.querySelectorAll("[data-tab]").forEach(
    (x) =>
      (x.onclick = () => {
        state.tab = x.dataset.tab;
        render();
      }),
  );
  bindPortalActions();
}
async function login() {
  await initLiffOnce();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: cleanLiffRedirectUrl() });
    return;
  }
  // Full-size LIFF 的原生加好友視窗：不離開目前登入流程。
  // 需先在 LINE Developers 將官方帳號連結至此 LINE Login Channel。
  if (liff.isInClient() && typeof liff.requestFriendship === "function") {
    const friendship = await liff.getFriendship().catch(() => null);
    if (!friendship?.friendFlag) {
      await liff.requestFriendship();
      const confirmed = await liff.getFriendship().catch(() => null);
      if (!confirmed?.friendFlag) throw new Error("請先在上方視窗加入官方帳號，再繼續登入");
    }
  }
  const idToken = liff.getIDToken();
  const lineProfile = await liff.getProfile().catch(() => null);
  const r = await api("/v1/auth/line/verify", {
    method: "POST",
    body: JSON.stringify({
      idToken,
      accessToken: liff.getAccessToken() || "",
      inviteToken: state.invite,
      pictureUrl: lineProfile?.pictureUrl || "",
      displayName: lineProfile?.displayName || "",
    }),
  });
  state.token = r.sessionToken;
  localStorage.setItem("mirabeauty_session", state.token);
  state.member = r.member;
  sessionStorage.removeItem("mirabeauty_invite");
  if (state.courseSession) state.tab = "courses";
  history.replaceState({}, "", state.tab === "daily" ? `${location.pathname}?tab=daily` : location.pathname);
  await render();
}
async function renderLogin() {
  $("#app").innerHTML =
    `<section class="hero"><h1>MiraBeauty 會員中心</h1><p>登入、點數、課程與每日任務</p></section><div class="content"><div class="card"><h2>${state.invite ? "受邀加入 MiraBeauty" : "使用 LINE 登入"}</h2><p class="muted">${state.invite ? "點擊後將在 LIFF 內確認官方帳號好友狀態，完成後自動登入並建立推薦關係。" : "以 LINE 身份建立你的會員、邀約與點數紀錄。"}</p><button class="btn" id="login">${state.invite ? "加入並使用 LINE 登入" : "LINE Login"}</button></div></div>`;
  $("#login").onclick = () => login().catch((e) => alert(e.message));
}
async function render() {
  // 已有工作階段的會員再次從邀約 QR 進站時，保留單一步驟讓他確認推薦關係；
  // 不自動重導，避免某些 LINE WebView 停在載入畫面。
  if (state.token && state.invite) return renderLogin();
  if (state.pendingCardShareId) return resumePendingCardShare();
  if (state.cardShareMode && state.cardShareId) return shareCardFromHeader();
  if (state.publicCard) return publicCard();
  if (!state.token) return renderLogin();
  try {
    state.member = (await api("/v1/me")).member;
  } catch {
    state.token = "";
    localStorage.removeItem("mirabeauty_session");
    return renderLogin();
  }
  if (!state.member.profileCompletedAt) return profile(true);
  if (state.smartCheckin) return smartCheckin();
  if (state.courseSession) state.tab = "courses";
  if (state.tab === "wallet") return wallet();
  if (state.tab === "courses") return courses();
  if (state.tab === "daily") return daily();
  if (state.tab === "card") return card();
  if (state.tab === "profile") return profile();
  return home();
}
const smartCheckinReason = { no_active_session:"目前沒有可報到的活動，請確認報到時間。", registration_required:"尚未報名此場活動，無法完成簽到。", session_unavailable:"此場活動目前無法簽到。" };
async function smartCheckin() {
  state.tab = "courses";
  layout('<section class="card smart-checkin-result"><h2>智慧簽到驗證中</h2><p class="muted">正在確認你的報名資格、報到時間與活動場次…</p></section>');
  try {
    const result = await api("/v1/course-sessions/smart-check-in", { method:"POST", body:"{}" });
    const message = result.duplicate ? "你已完成本場簽到，無需重複報到。" : "簽到成功，課程簽到點數已依規則入帳。";
    layout(`<section class="card smart-checkin-result success"><h2>✓ ${message}</h2><p class="muted">已完成報名資格、報到時間與活動場次驗證。</p><button class="btn" id="backCourses">查看課程紀錄</button></section>`);
  } catch (error) {
    const text = smartCheckinReason[error.message] || error.message || "智慧簽到失敗";
    layout(`<section class="card smart-checkin-result"><h2>暫時無法完成簽到</h2><p class="muted">${esc(text)}</p><button class="btn alt" id="retrySmartCheckin">重新驗證</button></section>`);
  }
  state.smartCheckin = false;
  sessionStorage.removeItem("mirabeauty_smart_checkin");
  history.replaceState({}, "", location.pathname);
  $("#backCourses")?.addEventListener("click", () => courses());
  $("#retrySmartCheckin")?.addEventListener("click", () => { state.smartCheckin = true; smartCheckin(); });
}
const portalIcon = (name) => ({
  courses: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.2c1.3 2.3 3 3.3 5.2 3.6-1.6 1.6-2.2 3.3-1.8 5.5-2.1-.6-3.5-.1-5.4 1.4.1-2.4-.8-4-2.8-5.4 2.3-.6 3.8-2 4.8-5.2Z"/><path d="M18.8 14.5c.5.9 1.2 1.3 2.1 1.5-.7.6-.9 1.3-.7 2.2-.8-.3-1.4 0-2.2.5.1-.9-.3-1.6-1.1-2.1.9-.2 1.5-.8 1.9-1.9Z"/></svg>`,
  daily: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4.6"/><path d="m9.1 12.6-1.4 7 4.3-2 4.3 2-1.4-7"/><path d="m12 6.5.75 1.7 1.85.15-1.4 1.22.42 1.8L12 10.4l-1.62 1.02.42-1.8-1.4-1.22 1.85-.15Z"/></svg>`,
  profile: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.3" y="4.3" width="15.4" height="15.4" rx="3.2"/><circle cx="12" cy="12" r="3.2"/><path d="M8 7.1h.01M16 7.1h.01"/></svg>`,
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 11 7.5-6.2 7.5 6.2v8.3H4.5z"/><path d="M9 19.3v-4.4h6v4.4M12 7.2v3.1M10.45 8.75h3.1"/></svg>`
}[name] || "");
const portalMenu = () => `<section class="portal-menu portal-menu-compact" aria-label="會員功能"><button data-home-action="courses"><i class="portal-menu-icon navy">${portalIcon("courses")}</i><span>課程活動</span></button><button data-home-action="daily"><i class="portal-menu-icon coral">${portalIcon("daily")}</i><span>簽到贈點</span></button><button data-home-action="card"><i class="portal-menu-icon pink">${portalIcon("profile")}</i><span>我的名片</span></button><button data-home-action="home"><i class="portal-menu-icon green">${portalIcon("home")}</i><span>首頁</span></button></section>`;
function bindPortalActions(){document.querySelectorAll("[data-home-action]").forEach((button)=>(button.onclick=async()=>{const action=button.dataset.homeAction;if(action==="share")return showShareQr();if(action==="walletqr"){const panel=$("#walletPanel");if(!panel){state.tab="wallet";return render()}$(".site-home-frame")?.classList.add("hidden");panel.classList.remove("hidden");panel.scrollIntoView({behavior:"smooth",block:"start"});return showWalletQr("homeWalletQr","homeWalletExpire")}state.tab=action==="home"?"home":action==="daily"?"daily":action==="courses"?"courses":action==="profile"?"profile":action==="card"?"card":"wallet";await render()}));$("#copyInvite")?.addEventListener("click",copyInvite)}
async function home() {
  const wallet = await api("/v1/points/wallet");
  layout(
    `<section class="member-portal"><div class="portal-profile" data-home-action="profile">${avatar()}<strong>${esc(state.member?.displayName || "LINE 會員")}</strong></div><div class="portal-primary" data-home-action="wallet"><span class="portal-icon">▣</span><div><span>點數錢包</span><strong>${format(wallet.wallet.balance)}</strong></div></div><div class="portal-primary" data-home-action="share"><span class="portal-icon">▦</span><div><span>專屬 QR</span><strong>分享</strong></div></div></section>${portalMenu()}<section class="site-home-frame"><iframe title="MiraBeauty 官網" src="https://mirabeauty.com.tw/about" loading="lazy"></iframe></section><section id="sharePanel" class="card qr-card quick-panel hidden"><h3>我的分享 QR 碼</h3><p class="muted">朋友掃描後會帶入你的系統推薦關係。</p><div id="shareQr" class="qr"></div><button class="btn alt" id="copyInvite">複製邀約連結</button></section><section id="walletPanel" class="card qr-card quick-panel hidden"><h3>我的點數錢包 QR 碼</h3><p class="muted">供現場人員掃描識別；每次產生後 60 秒失效。</p><div id="homeWalletQr" class="qr"></div><p id="homeWalletExpire" class="muted small"></p></section>`,
  );
}
async function invite() {
  return api("/v1/invite-links", { method: "POST", body: "{}" });
}
async function showShareQr() {
  try {
    const r = await invite();
    $(".site-home-frame")?.classList.add("hidden");
    const panel = $("#sharePanel");
    panel?.classList.remove("hidden");
    $("#shareQr").innerHTML = "";
    new QRCode($("#shareQr"), { text: r.invite.url, width: 210, height: 210 });
    $("#shareQr").dataset.url = r.invite.url;
    panel?.scrollIntoView({ behavior:"smooth", block:"start" });
  } catch (error) {
    alert(error.message || "分享 QR 碼產生失敗");
  }
}
async function copyInvite() {
  const url = $("#shareQr").dataset.url || (await invite()).invite.url;
  await navigator.clipboard.writeText(url);
  if (navigator.share) await navigator.share({ title: "MiraBeauty 邀請", url });
  else alert("邀約網址已複製");
}
async function showWalletQr(qrId, expiryId) {
  const q = await api("/v1/points/wallet/qr", { method: "POST", body: "{}" });
  const node = $("#" + qrId);
  node.innerHTML = "";
  new QRCode(node, { text: q.qrPayload, width: 210, height: 210 });
  $("#" + expiryId).textContent = "QR Code 將於 60 秒後失效";
  setTimeout(() => {
    node.innerHTML = "";
    $("#" + expiryId).textContent = "QR Code 已失效，請重新產生";
  }, 60000);
}
async function wallet() {
  const r = await api("/v1/points/wallet");
  layout(
    `<div class="card"><div class="muted">${esc(r.wallet.programName)}</div><div class="points">${r.wallet.balance}</div><button class="btn" id="walletQr">顯示動態錢包 QR Code</button><div id="qr" class="qr"></div><p id="expire" class="muted small"></p></div><div class="card"><h3>點數明細</h3>${r.wallet.entries.length ? r.wallet.entries.map((x) => `<div class="item"><b>${esc(pointEventLabel[x.event_type] || x.event_type)}</b><span class="row"><span class="muted">${esc(x.created_at)}</span><b>+${x.delta}</b></span></div>`).join("") : '<p class="muted">尚無點數紀錄</p>'}</div>`,
  );
  $("#walletQr").onclick = () => showWalletQr("qr", "expire");
}
async function courses() {
  const [all, mine] = await Promise.all([
    api("/v1/courses"),
    api("/v1/courses/my"),
  ]);
  const registered = new Set(mine.sessions.map((x) => x.sessionId));
  let scanNotice = "";
  if (state.courseSession) {
    const target = all.sessions.find((session) => session.sessionId === state.courseSession);
    if (target && !registered.has(target.sessionId)) {
      try {
        const result = await api(`/v1/course-sessions/${encodeURIComponent(target.sessionId)}/register`, { method:"POST", body:JSON.stringify({source:"calendar_qr"}) });
        registered.add(target.sessionId);
        scanNotice = result.duplicate ? "此課程已完成報名。" : `已完成「${target.title || target.courseTitle}」掃碼報名；點數將依課程報名規則入帳。`;
      } catch (error) { scanNotice = `掃碼報名失敗：${error.message}`; }
    } else if (!target) scanNotice = "此活動不存在或已下架。";
    state.courseSession = "";
    sessionStorage.removeItem("mirabeauty_course_session");
    history.replaceState({}, "", `${location.pathname}?tab=courses`);
  }
  const formatCourseDate = (value) => new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", month:"numeric", day:"numeric", weekday:"short" }).format(new Date(value));
  const formatCourseTime = (value) => new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value));
  const formatRecordTime = (value) => value ? new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value)) : "—";
  const activityHeader = `<div class="course-page-head"><h2>課程活動</h2><button class="course-record-tag ${state.courseView === "records" ? "active" : ""}" data-course-view="${state.courseView === "records" ? "catalog" : "records"}">${state.courseView === "records" ? "活動列表" : "課程紀錄"}</button></div>`;
  const statusOf = (session) => session.attendanceStatus === "verified" ? ["已完成", "completed"] : session.registrationStatus === "cancelled" ? ["已取消", "cancelled"] : ["已報名", "registered"];
  const records = mine.sessions.length
    ? `<section class="course-records">${mine.sessions.map((s) => { const [status, type] = statusOf(s); return `<article class="course-record-card"><div class="course-record-top"><div><small>場次紀錄</small><h3>${esc(s.courseTitle || s.title)}</h3></div><span class="course-status ${type}">${status}</span></div><p class="course-record-id">${esc(s.sessionId)}</p><div class="course-record-details"><div><span>活動日期</span><b>${esc(formatCourseDate(s.startsAt))}</b></div><div><span>活動時間</span><b>${esc(formatCourseTime(s.startsAt))}–${esc(formatCourseTime(s.endsAt))}</b></div><div><span>報名時間</span><b>${esc(formatRecordTime(s.registeredAt))}</b></div><div><span>${s.attendanceStatus === "verified" ? "簽到時間" : "報到狀態"}</span><b>${s.attendanceStatus === "verified" ? esc(formatRecordTime(s.attendanceAt)) : "尚未簽到"}</b></div></div></article>`; }).join("")}</section>`
    : '<div class="course-record-empty">目前還沒有報名任何課程</div>';
  const cards = all.sessions.length
    ? `<section class="course-grid">${all.sessions
        .map((s) => {
          const image = s.coverUrl
            ? `<img class="course-cover" src="${esc(s.coverUrl)}" alt="${esc(s.courseTitle)}">`
            : `<div class="course-cover course-cover-placeholder" aria-hidden="true"><span>✦</span></div>`;
          return `<article class="card course-card">${image}<div class="course-card-body"><h3>${esc(s.courseTitle || s.title)}</h3><p class="course-description">${esc(s.courseDescription || s.title || "活動說明將於現場提供")}</p><div class="course-card-footer"><div><strong>${esc(formatCourseDate(s.startsAt))}</strong><span>${esc(formatCourseTime(s.startsAt))}–${esc(formatCourseTime(s.endsAt))}</span></div><button class="btn" data-register="${s.sessionId}" ${registered.has(s.sessionId) ? "disabled" : ""}>${registered.has(s.sessionId) ? "已報名" : "我要報名"}</button></div></div></article>`;
        }).join("")}</section>`
    : '<div class="card muted">目前沒有公開課程</div>';
  layout(`${activityHeader}${scanNotice ? `<div class="notice">${esc(scanNotice)}</div>` : ""}${state.courseView === "records" ? records : cards}`);
  document.querySelector("[data-course-view]")?.addEventListener("click", async () => { state.courseView = document.querySelector("[data-course-view]").dataset.courseView; await courses(); });
  document.querySelectorAll("[data-register]").forEach(
    (x) =>
      (x.onclick = async () => {
        try {
          await api(`/v1/course-sessions/${x.dataset.register}/register`, {
            method: "POST",
            body: "{}",
          });
          alert("報名成功");
          courses();
        } catch (e) {
          alert(e.message);
        }
      }),
  );
}
async function daily() {
  if (dailyRotationTimer) {
    clearInterval(dailyRotationTimer);
    dailyRotationTimer = null;
  }
  const renderTabs = (campaigns = []) => campaigns.length ? `<div class="daily-top-tabs" role="tablist">${campaigns.map((campaign) => `<button type="button" class="daily-top-tab ${state.dailyCampaignId === campaign.id ? "active" : ""}" data-daily-campaign="${esc(campaign.id)}">${esc(campaign.name || "簽到活動")}</button>`).join("")}</div>` : "";
  const bindTabs = () => {
    document.querySelectorAll("[data-daily-campaign]").forEach((button) => {
      button.onclick = () => { state.dailyPanel = "checkin"; state.dailyCampaignId = button.dataset.dailyCampaign; daily(); };
    });
  };
  const query = state.dailyCampaignId ? `?campaignId=${encodeURIComponent(state.dailyCampaignId)}` : "";
  const r = await api(`/v1/daily-ad${query}`);
  const campaigns = r.campaigns || [];
  if (!state.dailyCampaignId && r.campaign?.id) state.dailyCampaignId = r.campaign.id;
  if (!r.campaign && campaigns.length && state.dailyCampaignId) {
    state.dailyCampaignId = campaigns[0].id;
    return daily();
  }
  state.daily = { ...r, campaigns };
  const tabs = renderTabs(campaigns);
  if (!r.campaign) {
    layout(`${tabs}<div class="card">今天沒有輪播簽到活動。</div>`);
    bindTabs();
    return;
  }
  const completed = new Set(r.qualifiedCreativeIds || []);
  if (!r.creatives.length) {
    layout(`${tabs}<div class="card">此輪播活動尚未設定素材。</div>`);
    bindTabs();
    return;
  }
  const cards = [...r.creatives];
  if (r.campaign.rotationMode === "random") {
    for (let index = cards.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [cards[index], cards[swap]] = [cards[swap], cards[index]];
    }
  }
  const cardHtml = (creative, index) => {
    const ratio = String(creative.image_aspect_ratio || "400:600").replace(":", " / ");
    const mode = creative.image_aspect_mode === "fit" ? "contain" : "cover";
    const bubbleWidths = { nano: "48%", micro: "56%", deca: "64%", hecto: "72%", kilo: "82%", mega: "92%", giga: "100%" };
    const bubbleWidth = bubbleWidths[creative.bubble_size] || bubbleWidths.nano;
    const detailLink = creative.image_link || creative.target_url;
    const media = `<div class="daily-media-frame" style="aspect-ratio:${esc(ratio)}"><${creative.creative_type === "video" ? "video controls playsinline" : "img"} class="daily-media" ${creative.creative_type === "video" ? "" : `alt="${esc(creative.title || `第 ${index + 1} 頁`)}"`} src="${esc(creative.media_url)}" style="object-fit:${mode}"></${creative.creative_type === "video" ? "video" : "img"}></div>`;
    const extraButtons = (creative.buttons || []).filter((button) => button.type === "uri" && button.uri).map((button) => `<a class="btn alt link-btn" target="_blank" rel="noopener" href="${esc(button.uri)}" ${button.color ? `style="background:${esc(button.color)};color:#fff"` : ""}>${esc(button.label)}</a>`).join("");
    const detailButton = detailLink ? `<a class="btn alt detail-button" target="_blank" rel="noopener" href="${esc(detailLink)}">詳細<br>說明</a>` : `<button class="btn alt detail-button" data-detail="${esc(creative.id)}">詳細<br>說明</button>`;
    const watchLabel = completed.has(creative.id) ? "已完成" : "開始<br>觀看";
    return `<article class="daily-slide ${completed.has(creative.id) ? "complete" : ""}" data-creative-id="${esc(creative.id)}" style="--bubble-width:${bubbleWidth}">${media}<div class="daily-slide-body"><div class="daily-actions"><button class="btn watch-button" data-watch="${esc(creative.id)}" ${completed.has(creative.id) ? "disabled" : ""}>${watchLabel}</button>${detailButton}</div>${extraButtons ? `<div class="daily-extra-actions">${extraButtons}</div>` : ""}<p class="muted watch-status"></p></div></article>`;
  };
  layout(`${tabs}<div class="daily-carousel" aria-label="每日輪播活動">${cards.map(cardHtml).join("")}</div><button class="btn ${r.checkedIn ? "alt" : ""}" id="checkin" ${!r.checkedIn && r.qualifiedCreativeCount < r.campaign.requiredCreativeCount ? "disabled" : ""}>${r.checkedIn ? "今日已簽到（確認點數）" : `今日簽到（已完成 ${r.qualifiedCreativeCount}/${r.campaign.requiredCreativeCount} 項）`}</button>`);
  bindTabs();
  document.querySelectorAll("[data-watch]").forEach((button) => {
    button.onclick = () => {
      const creative = r.creatives.find((item) => item.id === button.dataset.watch);
      if (creative) watchCreative(creative, button.closest(".daily-slide"));
    };
  });
  document.querySelectorAll("[data-detail]").forEach((button) => {
    button.onclick = () => {
      const creative = cards.find((item) => item.id === button.dataset.detail);
      if (!creative) return;
      const dialog = document.createElement("div");
      dialog.className = "media-dialog";
      dialog.innerHTML = `<div class="media-dialog-backdrop" data-close-detail></div><div class="media-dialog-panel" role="dialog" aria-modal="true" aria-label="詳細說明"><button class="media-dialog-close" data-close-detail aria-label="關閉">×</button>${creative.creative_type === "video" ? `<video controls playsinline autoplay src="${esc(creative.media_url)}"></video>` : `<img src="${esc(creative.media_url)}" alt="${esc(creative.title || "詳細說明")}">`}</div>`;
      dialog.querySelectorAll("[data-close-detail]").forEach((close) => { close.onclick = () => dialog.remove(); });
      document.body.append(dialog);
    };
  });
  const carousel = document.querySelector(".daily-carousel");
  if (carousel && cards.length > 1) {
    let pausedUntil = 0;
    carousel.addEventListener("pointerdown", () => { pausedUntil = Date.now() + 9000; });
    carousel.addEventListener("scroll", () => { if (carousel.matches(":hover")) pausedUntil = Date.now() + 5000; }, { passive: true });
    dailyRotationTimer = setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() < pausedUntil) return;
      const next = carousel.scrollLeft + carousel.clientWidth * 0.86;
      if (next >= carousel.scrollWidth - carousel.clientWidth - 8) carousel.scrollTo({ left: 0, behavior: "smooth" });
      else carousel.scrollTo({ left: next, behavior: "smooth" });
    }, 4000);
  }
  $("#checkin").onclick = async () => {
    try {
      const x = await api("/v1/daily-ad/check-in", { method: "POST", body: JSON.stringify({ campaignId: r.campaign.id }) });
      const pointText = x.pointResult?.awarded ? "，點數已入帳" : x.pointResult?.duplicate ? "，點數已確認入帳" : x.pointResult?.reason === "no_active_rule" ? "，但後台尚未啟用「每日簽到」點數規則" : "";
      alert(x.duplicate ? `今天已簽到${pointText}` : `簽到成功${pointText || "，點數已依規則處理"}`);
      daily();
    } catch (e) {
      alert(e.message);
    }
  };
}
async function watchCreative(creative, card) {
  const button = card?.querySelector(".watch-button");
  button.disabled = true;
  const status = card?.querySelector(".watch-status");
  try {
    const s = await api("/v1/daily-ad/view-sessions", {
      method: "POST",
      body: JSON.stringify({ creativeId: creative.id, campaignId: state.daily?.campaign?.id || state.dailyCampaignId }),
    });
    const required = Math.max(0, Number(creative.required_watch_seconds) || 0);
    const started = Date.now();
    let settled = false;
    const timer = setInterval(async () => {
      if (settled) return;
      const seconds = Math.floor((Date.now() - started) / 1000);
      const media = card?.querySelector(".daily-media");
      const ratio =
        creative.creative_type === "video" && media?.duration
          ? Math.min(1, media.currentTime / media.duration)
          : 1;
      status.textContent = `觀看中 ${Math.min(seconds, required)} / ${required} 秒`;
      if (seconds < required || document.visibilityState !== "visible") return;
      settled = true;
      try {
        const p = await api(`/v1/daily-ad/view-sessions/${s.token}/progress`, {
          method: "POST",
          body: JSON.stringify({
            watchedSeconds: seconds,
            completionRatio: ratio,
            pageVisible: true,
          }),
        });
        clearInterval(timer);
        if (p.qualified) {
          status.textContent = "此項完成，準備下一項…";
          setTimeout(daily, 700);
        } else {
          settled = false;
          status.textContent = "請繼續觀看";
          button.disabled = false;
        }
      } catch (e) {
        clearInterval(timer);
        status.textContent = e.message;
        button.disabled = false;
      }
    }, 1000);
    if (creative.creative_type === "video")
      card?.querySelector(".daily-media")
        ?.play()
        .catch(() => {});
    setTimeout(() => clearInterval(timer), 600000);
  } catch (e) {
    status.textContent = e.message;
    button.disabled = false;
  }
}
function cardPublicUrl(cardId) {
  return `${location.origin}/c/${encodeURIComponent(cardId)}`;
}
function cardSharePickerUrl(cardId) {
  if (!state.config?.liffId) return cardPublicUrl(cardId);
  const url = new URL(`https://liff.line.me/${encodeURIComponent(state.config.liffId)}`);
  url.searchParams.set("shareCardId", cardId);
  url.searchParams.set("share", "1");
  return url.toString();
}
function cardActionItems(card) {
  const actions = [];
  const push = (label, type, value) => { if (value) actions.push({ label, type, value }); };
  push("撥打電話", "phone", card.mobile ? `tel:${card.mobile.replace(/[\s()-]/g, "")}` : "");
  push("寄送 Email", "email", card.email ? `mailto:${card.email}` : "");
  push("公司網站", "url", card.websiteUrl);
  push("加入 LINE", "line", card.lineUrl);
  push("查看地圖", "map", card.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}` : "");
  (card.buttons || []).forEach((button) => push(button.label, button.type, button.value));
  const seen = new Set();
  return actions.filter((item) => item.label && item.value && !seen.has(`${item.label}:${item.value}`) && (seen.add(`${item.label}:${item.value}`), true));
}
const cardVersionMeta = {
  standard: { label:"標準", aspect:"20:13", className:"standard" },
  full: { label:"滿版", aspect:"2:3", className:"full" },
  square: { label:"正方", aspect:"1:1", className:"square" },
};
function activeCardVersion(card) {
  const id = card.selectedVersion && cardVersionMeta[card.selectedVersion] ? card.selectedVersion : "standard";
  return { id, ...(card.versions?.[id] || {}), ...(cardVersionMeta[id] || cardVersionMeta.standard) };
}
function cardWithVersion(card, id) {
  const version = { ...(card.versions?.[id] || {}), ...(cardVersionMeta[id] || cardVersionMeta.standard) };
  return { ...card, selectedVersion:id, coverUrl:version.coverUrl || "", buttons:version.buttons || [], serviceDescription:version.description || card.serviceDescription, serviceTextAlign:version.serviceTextAlign || card.serviceTextAlign || "left", descriptionTextAlign:version.descriptionTextAlign || card.descriptionTextAlign || "left", versionTitle:version.title || card.displayName, version };
}
function cardFlex(card) {
  const action = (label, uri, color = "#B96072") => ({ type:"button", style:"primary", height:"sm", color, action:{ type:"uri", label:String(label).slice(0,20), uri } });
  const version = activeCardVersion(card);
  const metaFields = [
    card.companyName,
    [card.jobTitle, card.department].filter(Boolean).join("｜"),
  ].filter(Boolean).join("\n");
  const serviceAlign = ({ left:"start", center:"center", right:"end" })[card.descriptionTextAlign || card.serviceTextAlign] || "start";
  const bodyContents = [
    { type:"text", text:card.versionTitle || card.displayName || "MiraBeauty 會員", weight:"bold", size:"xl", color:"#2A2030", align:"center", wrap:true },
    ...(card.englishName ? [{ type:"text", text:card.englishName, size:"sm", color:"#857581", margin:"sm", align:"center", wrap:true }] : []),
    ...(metaFields ? [{ type:"text", text:metaFields, size:"sm", color:"#5E5260", align:"center", wrap:true, margin:"md", maxLines:2 }] : []),
    ...(card.serviceDescription ? [{ type:"text", text:card.serviceDescription, size:"sm", color:"#5E5260", align:serviceAlign, wrap:true, margin:"md", maxLines:4 }] : []),
  ];
  // 分享 Flex 的按鈕必須與「底部按鈕設定」完全同一份資料，
  // 不再混入系統自動產生的聯絡按鈕，避免預覽和實際訊息不同。
  const actions = (card.buttons || []).filter((button) => button?.enabled !== false && button?.label && button?.value).slice(0, 4);
  return {
    type:"bubble", size:version.id === "full" ? "giga" : "mega",
    ...(card.coverUrl ? { hero:{ type:"image", url:card.coverUrl, size:"full", aspectRatio:version.aspect, aspectMode:"cover" } } : {}),
    header:{ type:"box", layout:"horizontal", justifyContent:"space-between", alignItems:"center", paddingAll:"8px", contents:[
      { type:"box", layout:"vertical", flex:1, contents:[] },
      { type:"box", layout:"vertical", justifyContent:"center", backgroundColor:"#EF4444", width:"65px", height:"25px", cornerRadius:"25px", contents:[
        { type:"text", text:"分享", weight:"bold", align:"center", color:"#FFFFFF", size:"xs" }
      ], action:{ type:"uri", uri:cardSharePickerUrl(card.id) } }
    ] },
    body:{ type:"box", layout:"vertical", paddingAll:"18px", contents:bodyContents },
    footer:{ type:"box", layout:"vertical", spacing:"sm", contents:
      actions.map((item) => action(item.label, item.value, item.color || "#B96072")),
    },
  };
}
async function compressCardImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("請選擇圖片檔案");
  const source = await createImageBitmap(file);
  try {
    let smallest = null;
    for (const maxSide of [1600, 1280, 1024, 800, 640, 512]) {
      const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.72, 0.60, 0.48, 0.36]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (!blob) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        // 優先保留畫質：可達原本目標時即停止；否則仍使用最小壓縮結果上傳。
        if (blob.size <= 900 * 1024) return new File([blob], "card-cover.webp", { type:"image/webp" });
      }
    }
    if (!smallest) throw new Error("圖片壓縮失敗，請改用其他圖片");
    return new File([smallest], "card-cover.webp", { type:"image/webp" });
  } finally {
    source.close?.();
  }
}
async function uploadCardImage(file) {
  const compressed = await compressCardImage(file);
  const form = new FormData(); form.append("image", compressed);
  const response = await fetch("/v1/cards/me/media", { method:"POST", headers:state.token ? { authorization:`Bearer ${state.token}` } : {}, body:form });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || "圖片上傳失敗"); return body.url;
}
let cardCropper = null;
function ensureCardCropperModal() {
  let modal = $("#cardCropperModal");
  if (modal) return modal;
  document.body.insertAdjacentHTML("beforeend", `<div class="card-cropper-modal" id="cardCropperModal" role="dialog" aria-modal="true"><div class="card-cropper-sheet"><div class="card-cropper-head"><strong>裁切封面圖片</strong><button type="button" id="closeCardCropper">×</button></div><div class="card-cropper-stage"><img id="cardCropperImage" alt="裁切圖片"></div><div class="card-cropper-tools"><button type="button" data-crop-action="zoom-out">縮小</button><button type="button" data-crop-action="zoom-in">放大</button><button type="button" data-crop-action="rotate">旋轉</button><button type="button" data-crop-action="reset">重設</button></div><div class="card-cropper-actions"><button type="button" class="btn alt" id="cancelCardCropper">取消</button><button type="button" class="btn" id="confirmCardCropper">確認裁切</button></div></div></div>`);
  return $("#cardCropperModal");
}
async function openCardCropper(file, versionId) {
  if (!window.Cropper) throw new Error("裁切器載入失敗，請確認網路後重新開啟頁面");
  if (!file?.type?.startsWith("image/")) throw new Error("請選擇圖片檔案");
  const modal = ensureCardCropperModal(); const image = $("#cardCropperImage");
  const ratio = cardVersionMeta[versionId]?.aspect || "20:13"; const [width,height] = ratio.split(":").map(Number);
  const close = () => { cardCropper?.destroy(); cardCropper=null; URL.revokeObjectURL(image.src); modal.classList.remove("open"); };
  $("#closeCardCropper").onclick = close; $("#cancelCardCropper").onclick = close;
  modal.classList.add("open"); image.src = URL.createObjectURL(file);
  await new Promise((resolve,reject) => { image.onload=resolve; image.onerror=reject; });
  cardCropper?.destroy(); cardCropper = new Cropper(image, { aspectRatio:width / height, viewMode:1, dragMode:"move", autoCropArea:.92, cropBoxMovable:true, cropBoxResizable:true, zoomable:true, zoomOnTouch:true, zoomOnWheel:true, movable:true, responsive:true, background:false, guides:true, center:true, highlight:false });
  modal.querySelectorAll("[data-crop-action]").forEach((button) => button.onclick = () => { const action=button.dataset.cropAction; if (action === "zoom-in") cardCropper.zoom(.1); if (action === "zoom-out") cardCropper.zoom(-.1); if (action === "rotate") cardCropper.rotate(90); if (action === "reset") cardCropper.reset(); });
  $("#confirmCardCropper").onclick = async () => { try { const button=$("#confirmCardCropper"); button.disabled=true; button.textContent="處理中"; const size = versionId === "full" ? {width:900,height:1350} : versionId === "square" ? {width:1000,height:1000} : {width:1200,height:780}; const canvas=cardCropper.getCroppedCanvas({ ...size, imageSmoothingEnabled:true, imageSmoothingQuality:"high" }); const blob=await new Promise((resolve)=>canvas.toBlob(resolve,"image/webp",.86)); if (!blob) throw new Error("圖片裁切失敗"); const imageUrl=await uploadCardImage(new File([blob],"card-cover.webp",{type:"image/webp"})); const coverInput=$("#my-v1-img-url") || $("#cardVersionCover"); coverInput.value=imageUrl; coverInput.dispatchEvent(new Event("input", { bubbles:true })); close(); alert("圖片已裁切並上傳，請按儲存名片設定"); } catch(error) { alert(error.message); } finally { const button=$("#confirmCardCropper"); if (button) { button.disabled=false; button.textContent="確認裁切"; } } };
}
async function prepareCardLiff() {
  await initLiffOnce();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: cleanLiffRedirectUrl() });
    return false;
  }
  return true;
}
async function sharePersonalCard(card) {
  // PC 外部瀏覽器同樣由官方 SDK 透過 OTT 開啟通訊錄；
  // 不能以 isInClient() 判斷，也不能手動拼接分享網址。
  state.pendingCardShareId = card.id;
  sessionStorage.setItem("mirabeauty_pending_card_share_id", card.id);
  await resumePendingCardShare();
}
function clearPendingCardShare() {
  state.pendingCardShareId = "";
  sessionStorage.removeItem("mirabeauty_pending_card_share_id");
}
async function resumePendingCardShare() {
  let redirectedToLogin = false;
  try {
    await initLiffOnce();
    if (!liff.isLoggedIn()) {
      redirectedToLogin = true;
      liff.login({ redirectUri: cleanLiffRedirectUrl() });
      return;
    }
    if (!liff.isApiAvailable?.("shareTargetPicker")) throw new Error("此 LINE 環境未提供分享通訊錄。請在 LINE Developers 的 LIFF 設定啟用 shareTargetPicker，並從 LINE 開啟此 LIFF。");
    const result = await api(`/v1/cards/${encodeURIComponent(state.pendingCardShareId)}/public`);
    const shared = await liff.shareTargetPicker([{ type:"flex", altText:`${result.card.displayName || "MiraBeauty 會員"} 的數位名片`, contents:cardFlex(result.card) }]);
    if (shared !== false) alert("名片已送出");
  } catch (error) {
    // 後台剛啟用 shareTargetPicker 時，舊的 LINE access token 仍可能沒有新權限。
    // 清除舊 token 後由下一次載入重新登入，讓 SDK 取得新的 OTT/權限。
    if (/not allowed|not available|shareTargetPicker/i.test(String(error?.message || ""))) {
      alert("LINE 分享權限已更新，將重新登入後再開啟通訊錄。");
      redirectedToLogin = true; // 保留 pendingCardShareId，重載後會自動續接分享。
      try { if (liff.isLoggedIn()) liff.logout(); } catch {}
      location.replace(cleanLiffRedirectUrl());
      return;
    }
    alert(error.message || "無法開啟名片分享通訊錄");
  } finally {
    if (!redirectedToLogin) clearPendingCardShare();
  }
}
function clearCardShareMode() {
  state.cardShareId = "";
  state.cardShareMode = false;
  sessionStorage.removeItem("mirabeauty_card_share_id");
  sessionStorage.removeItem("mirabeauty_card_share_mode");
  const url = new URL(location.href);
  url.searchParams.delete("shareCardId");
  url.searchParams.delete("share");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
async function shareCardFromHeader() {
  const cardId = state.cardShareId;
  let redirectedToLogin = false;
  let pickerFinished = false;
  try {
    if (!await prepareCardLiff()) { redirectedToLogin = true; return; }
    if (!liff.isApiAvailable?.("shareTargetPicker")) throw new Error("此 LIFF 尚未啟用分享功能，請在 LINE Developers 啟用 shareTargetPicker");
    const result = await api(`/v1/cards/${encodeURIComponent(cardId)}/public`);
    await liff.shareTargetPicker([{ type:"flex", altText:`${result.card.displayName || "MiraBeauty 會員"} 的數位名片`, contents:cardFlex(result.card) }]);
    pickerFinished = true; // 完成或取消都不要落回會員中心。
  } catch (error) {
    alert(error.message || "無法開啟名片分享通訊錄");
  } finally {
    if (!redirectedToLogin) clearCardShareMode();
    if (pickerFinished) {
      // 手機 LINE：回到原聊天訊息；PC 外部瀏覽器：保留公開名片頁。
      if (liff.isInClient?.()) {
        try { liff.closeWindow(); } catch {}
      } else {
        state.publicCard = cardId;
        history.replaceState({}, "", `/c/${encodeURIComponent(cardId)}`);
        await publicCard();
      }
    }
  }
}
async function sendPersonalCardToChat(card) {
  if (!await prepareCardLiff()) return;
  if (!liff.isInClient?.()) throw new Error("請從 LINE 聊天室內開啟會員中心，才能直接傳送到目前聊天室");
  try {
    const permission = await liff.permission?.query?.("chat_message.write");
    if (permission?.state !== "granted") {
      await liff.permission?.requestAll?.();
      const refreshed = await liff.permission?.query?.("chat_message.write");
      if (refreshed?.state && refreshed.state !== "granted") throw new Error("未授權聊天室傳送權限");
    }
  } catch (error) {
    if (error.message) throw error;
  }
  if (typeof liff.sendMessages !== "function") throw new Error("此 LINE 環境不支援聊天室傳送");
  await liff.sendMessages([{ type:"flex", altText:`${card.displayName || "MiraBeauty 會員"} 的數位名片`, contents:cardFlex(card) }]);
  alert("已傳送到目前聊天室");
}
function cardContactRows(card) {
  const fields = [
    ["公司名稱", card.companyName], ["職稱", card.jobTitle], ["部門", card.department],
    ["手機號碼", card.mobile], ["公司電話", card.companyPhone], ["電子郵件", card.email],
    ["公司網站", card.websiteUrl], ["LINE", card.lineUrl], ["公司地址", card.address], ["服務項目", card.serviceDescription],
  ].filter(([, value]) => value);
  return fields.length ? fields.map(([label,value]) => `<article class="business-card-field"><small>${esc(label)}</small><p>${esc(value)}</p></article>`).join("") : '<p class="muted">尚未填寫聯絡資料。</p>';
}
function customButtonEditor(button = {}, index = 0) {
  const color = /^#[0-9a-f]{6}$/i.test(button.color || "") ? button.color : "#B96072";
  return `<article class="card-button-editor" data-card-button-row><div class="card-button-editor-head"><strong>按鈕 ${index + 1}</strong><div><button type="button" data-move-card-button="-1" aria-label="上移">↑</button><button type="button" data-move-card-button="1" aria-label="下移">↓</button><button type="button" class="card-button-remove" data-remove-card-button>刪除</button></div></div><label>按鈕顏色<span class="card-colour-control"><input data-card-button-color-picker type="color" value="${esc(color)}"><input data-card-button-color value="${esc(color)}" placeholder="#B96072"></span></label><label>按鈕文字<input data-card-button-label placeholder="例如：加入 LINE 好友" value="${esc(button.label || "")}"></label><label>連結類型<select data-card-button-type><option value="url" ${button.type === "url" ? "selected" : ""}>網站連結</option><option value="phone" ${button.type === "phone" ? "selected" : ""}>電話</option><option value="email" ${button.type === "email" ? "selected" : ""}>Email</option><option value="line" ${button.type === "line" ? "selected" : ""}>LINE 連結</option><option value="map" ${button.type === "map" ? "selected" : ""}>地圖</option></select></label><label>網址／電話／LINE 連結<input data-card-button-value placeholder="https://... 或 tel:0927..." value="${esc(String(button.value || "").replace(/^(tel:|mailto:)/, ""))}"></label></article>`;
}
function collectCardButtons() {
  return Array.from(document.querySelectorAll("[data-card-button-row]")).map((row) => ({
    label: row.querySelector("[data-card-button-label]")?.value || "",
    type: row.querySelector("[data-card-button-type]")?.value || "url",
    value: row.querySelector("[data-card-button-value]")?.value || "",
    color: row.querySelector("[data-card-button-color]")?.value || "",
  })).filter((button) => button.label || button.value);
}
function bindCardButtonEditor(onChange = null) {
  const redraw = () => { if (typeof onChange === "function") onChange(); };
  document.querySelectorAll("[data-remove-card-button]").forEach((button) => button.onclick = () => { button.closest("[data-card-button-row]")?.remove(); redraw(); });
  document.querySelectorAll("[data-move-card-button]").forEach((button) => button.onclick = () => { const row=button.closest("[data-card-button-row]"); const sibling=Number(button.dataset.moveCardButton) < 0 ? row?.previousElementSibling : row?.nextElementSibling; if (row && sibling?.matches("[data-card-button-row]")) Number(button.dataset.moveCardButton) < 0 ? sibling.before(row) : sibling.after(row); redraw(); });
  document.querySelectorAll("[data-card-button-color-picker]").forEach((picker) => picker.oninput = () => { const field=picker.parentElement.querySelector("[data-card-button-color]"); if(field) field.value=picker.value; redraw(); });
  document.querySelectorAll("[data-card-button-row] input,[data-card-button-row] select").forEach((field) => field.oninput = redraw);
  $("#addCardButton")?.addEventListener("click", () => {
    const holder = $("#cardButtonRows");
    if (!holder || holder.querySelectorAll("[data-card-button-row]").length >= 4) return alert("最多可設定 4 個自訂按鈕");
    holder.insertAdjacentHTML("beforeend", customButtonEditor({}, holder.querySelectorAll("[data-card-button-row]").length));
    bindCardButtonEditor(onChange); redraw();
  });
}
function renderDigitalCardPreview(card, selected) {
  const holder = $("#cardLivePreview"); if (!holder) return;
  const coverUrl = $("#cardVersionCover")?.value.trim() || "";
  const title = $("#cardVersionTitle")?.value.trim() || card.displayName || "MiraBeauty 會員";
  const description = $("#cardVersionDescription")?.value.trim() || card.serviceDescription || "";
  const buttons = collectCardButtons();
  holder.className = `ecard-preview-card ${esc(selected.className)}`;
  holder.innerHTML = `${coverUrl ? `<img src="${esc(coverUrl)}" alt="名片封面">` : `<div class="ecard-cover-placeholder">${avatar()}</div>`}<div class="ecard-preview-copy"><strong>${esc(title)}</strong><span>${esc(description)}</span></div>${buttons.length ? `<div class="ecard-preview-buttons">${buttons.slice(0,4).map((button) => `<span style="--button-color:${esc(button.color || "#B96072")}">${esc(button.label || "按鈕")}</span>`).join("")}</div>` : ""}`;
}
// Ported from LINE-/index.html + js/modules/mycard.js: the editor is deliberately
// kept as its own source-shaped block, with only storage calls adapted to MiraBeauty.
function lineSourceEcardEditor(card, selected) {
  const version = cardWithVersion(card, selected.id);
  return `<section id="my-ecard-edit-state" class="line-source-ecard">
    <div class="line-source-ecard-top"><p>設定後即可在首頁一鍵發送數位名片</p><button type="button" class="line-source-qr" id="showMyCardQr">顯示條碼</button></div>
    <div class="line-source-ecard-panel">
      <input id="my-v1-img-url" type="hidden" value="${esc(version.coverUrl)}"><input id="lineSourceTitle" type="hidden" value="${esc(version.versionTitle || "")}"><textarea id="lineSourceDescription" hidden>${esc(version.serviceDescription || "")}</textarea><input id="lineSourceImageFile" type="file" accept="image/*" hidden>
      <div><p class="line-source-label">名片版型</p><div class="line-source-layouts">${Object.entries(cardVersionMeta).map(([id, meta]) => `<label><input type="radio" name="my-ecard-layout" value="${id}" ${id === selected.id ? "checked" : ""}><span>${meta.label}</span></label>`).join("")}</div></div>
      <p class="line-source-direct-hint">直接點擊預覽名片的封面、標題或說明，即可編輯。</p>
      <label class="line-source-field"><span>版面說明對齊</span><select id="lineSourceDescriptionAlign"><option value="left" ${version.descriptionTextAlign === "left" ? "selected" : ""}>靠左</option><option value="center" ${version.descriptionTextAlign === "center" ? "selected" : ""}>置中</option><option value="right" ${version.descriptionTextAlign === "right" ? "selected" : ""}>靠右</option></select></label>
      <div class="line-source-buttons"><div class="line-source-buttons-head"><p class="line-source-label">底部按鈕設定</p><button type="button" id="lineSourceAddButton">＋ 新增按鈕</button></div><div id="my-v1-buttons-list"></div></div>
      <button id="btn-save-my-ecard" type="button" class="line-source-save">儲存名片設定</button>
    </div>
    <aside class="line-source-preview"><p>即時預覽</p><div id="my-ecard-preview-area"></div></aside>
    <div class="line-source-share"><input id="cardPublicUrl" readonly value="${esc(cardPublicUrl(card.id))}"><div id="cardPublicQr" class="qr"></div><button id="sharePersonalCard" type="button">分享名片</button><button id="sendPersonalCard" type="button">傳送至目前聊天室</button><button id="copyCardUrl" type="button">複製名片網址</button></div>
  </section>`;
}
function renderLineSourceButtons(buttons, onChange) {
  const holder = $("#my-v1-buttons-list"); if (!holder) return;
  if (!buttons.length) { holder.innerHTML = `<p class="line-source-empty">尚未設定任何按鈕</p>`; return; }
  holder.innerHTML = buttons.map((button, index) => `<article class="line-source-button collapsed" data-card-button-row><div class="line-source-button-head"><strong>按鈕 ${index + 1}</strong><span><button type="button" data-line-toggle>展開</button><button type="button" data-line-remove="${index}">刪除</button></span></div><div class="line-source-button-fields"><label>按鈕顏色<span><input type="color" data-card-button-color-picker value="${esc(button.color || "#B96072")}"><input data-card-button-color value="${esc(button.color || "#B96072")}"></span></label><label>按鈕文字<input data-card-button-label value="${esc(button.label || "")}" placeholder="例如：加入 LINE 好友"></label><label>連結類型<select data-card-button-type><option value="url" ${button.type === "url" ? "selected" : ""}>網址</option><option value="phone" ${button.type === "phone" ? "selected" : ""}>電話</option><option value="email" ${button.type === "email" ? "selected" : ""}>Email</option><option value="line" ${button.type === "line" ? "selected" : ""}>LINE 連結</option><option value="map" ${button.type === "map" ? "selected" : ""}>地圖</option></select></label><label>網址／電話／LINE 連結<input data-card-button-value value="${esc(String(button.value || "").replace(/^(tel:|mailto:)/, ""))}" placeholder="https://... 或 tel:0927..."></label><div class="line-source-button-order"><button type="button" data-line-move="-1" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-line-move="1" ${index === buttons.length - 1 ? "disabled" : ""}>↓</button></div></div></article>`).join("");
  const sync = () => onChange?.();
  holder.querySelectorAll("input,select").forEach((input) => input.addEventListener("input", sync));
  holder.querySelectorAll("[data-card-button-color-picker]").forEach((picker) => picker.addEventListener("input", () => { picker.parentElement.querySelector("[data-card-button-color]").value=picker.value; sync(); }));
  holder.querySelectorAll("[data-line-toggle]").forEach((button) => button.onclick = () => {
    const card = button.closest("[data-card-button-row]");
    const collapsed = card?.classList.toggle("collapsed");
    button.textContent = collapsed ? "展開" : "收合";
  });
  holder.querySelectorAll("[data-line-remove]").forEach((button) => button.onclick = () => { buttons.splice(Number(button.dataset.lineRemove),1); renderLineSourceButtons(buttons,onChange); sync(); });
  holder.querySelectorAll("[data-line-move]").forEach((button) => button.onclick = () => { const index=Array.from(holder.querySelectorAll("[data-line-move]")).indexOf(button); const source=Math.floor(index/2); const target=source+Number(button.dataset.lineMove); if(target>=0&&target<buttons.length){ const item=buttons.splice(source,1)[0]; buttons.splice(target,0,item); renderLineSourceButtons(buttons,onChange); sync(); } });
}
function renderLineSourcePreview(card, selected) {
  const preview = $("#my-ecard-preview-area"); if (!preview) return;
  const cover = $("#my-v1-img-url")?.value.trim() || "";
  const title = $("#lineSourceTitle")?.value.trim() || card.displayName;
  const desc = $("#lineSourceDescription")?.value.trim() || card.serviceDescription || "";
  const descriptionAlign = $("#lineSourceDescriptionAlign")?.value || selected.descriptionTextAlign || "left";
  const buttons = collectCardButtons(); const ratio = selected.id === "full" ? "2/3" : selected.id === "square" ? "1/1" : "20/13";
  preview.innerHTML = `<div class="line-source-preview-card"><div class="line-source-preview-share">分享</div><button type="button" class="line-source-preview-cover" data-ecard-edit="cover" aria-label="更換封面圖片">${cover ? `<img style="aspect-ratio:${ratio}" src="${esc(cover)}" alt="名片封面">` : `<div class="line-source-preview-placeholder" style="aspect-ratio:${ratio}">${avatar()}</div>`}<em>點擊更換封面</em></button><div class="line-source-preview-body"><strong contenteditable="true" spellcheck="false" data-ecard-edit="title" aria-label="編輯版面標題">${esc(title)}</strong><span contenteditable="true" spellcheck="false" data-ecard-edit="description" style="text-align:${esc(descriptionAlign)}" aria-label="編輯版面說明">${esc(desc)}</span></div>${buttons.length ? `<div class="line-source-preview-footer">${buttons.slice(0,4).map((button,index)=>`<button type="button" data-ecard-edit="button" data-ecard-button-index="${index}" style="background:${esc(button.color || "#B96072")}">${esc(button.label || "按鈕")}</button>`).join("")}</div>` : ""}</div>`;
}
function bindWysiwygCardCanvas(updatePreview) {
  const canvas = $("#my-ecard-preview-area"); if (!canvas) return;
  canvas.querySelector('[data-ecard-edit="cover"]')?.addEventListener("click", () => $("#lineSourceImageFile")?.click());
  const title = canvas.querySelector('[data-ecard-edit="title"]');
  const description = canvas.querySelector('[data-ecard-edit="description"]');
  title?.addEventListener("input", () => { const field=$("#lineSourceTitle"); if (field) field.value=title.innerText.trim(); });
  description?.addEventListener("input", () => { const field=$("#lineSourceDescription"); if (field) field.value=description.innerText.trim(); });
  canvas.querySelectorAll('[data-ecard-edit="button"]').forEach((button) => button.addEventListener("click", () => {
    const rows = [...document.querySelectorAll("#my-v1-buttons-list [data-card-button-row]")];
    const row = rows[Number(button.dataset.ecardButtonIndex)];
    if (!row) return;
    row.classList.remove("collapsed");
    row.querySelector("[data-line-toggle]")?.replaceChildren("收合");
    row.scrollIntoView({ behavior:"smooth", block:"center" });
  }));
}
async function card() {
  const result = await api("/v1/cards/me");
  const myCard = result.card;
  if (!myCard) {
    layout(`<section class="card card-empty"><h2>建立我的名片</h2><p class="muted">建立後會以你的 LINE 名稱、頭貼與已填會員資料為起點；名片只會綁定目前的 LINE 帳號。</p><button class="btn" id="createMyCard">使用 LINE 資料建立名片</button></section>`);
    $("#createMyCard").onclick = async () => { try { await api("/v1/cards/me", { method:"PUT", body:"{}" }); state.cardView = "contact"; await card(); } catch (error) { alert(error.message); } };
    return;
  }
  const view = state.cardView || "contact";
  const tabs = `<div class="business-card-tabs"><button data-card-tab="contact" class="${view === "contact" ? "active" : ""}">聯絡資料</button><button data-card-tab="edit" class="${view === "edit" ? "active" : ""}">編輯內容</button><button data-card-tab="digital" class="${view === "digital" ? "active" : ""}">數位名片</button></div>`;
  let panel = "";
  if (view === "contact") panel = `<div class="business-card-contact">${cardContactRows(myCard)}<div class="business-card-contact-actions">${cardActionItems(myCard).map((item) => `<a href="${esc(item.value)}" ${item.type === "url" || item.type === "line" || item.type === "map" ? 'target="_blank" rel="noopener"' : ""}>${esc(item.label)}</a>`).join("")}</div></div>`;
  if (view === "edit") panel = `<form id="cardForm" class="business-card-form"><label>姓名<input id="cardDisplayName" value="${esc(myCard.displayName)}" required></label><label>英文名<input id="cardEnglishName" value="${esc(myCard.englishName)}"></label><label>公司名稱<input id="cardCompanyName" value="${esc(myCard.companyName)}"></label><label>職稱<input id="cardJobTitle" value="${esc(myCard.jobTitle)}"></label><label>部門<input id="cardDepartment" value="${esc(myCard.department)}"></label><label>手機號碼<input id="cardMobile" value="${esc(myCard.mobile)}"></label><label>公司電話<input id="cardCompanyPhone" value="${esc(myCard.companyPhone)}"></label><label>電子郵件<input id="cardEmail" type="email" value="${esc(myCard.email)}"></label><label>公司網站<input id="cardWebsiteUrl" type="url" placeholder="https://" value="${esc(myCard.websiteUrl)}"></label><label>LINE 連結<input id="cardLineUrl" type="url" placeholder="https://lin.ee/..." value="${esc(myCard.lineUrl)}"></label><label>公司地址<input id="cardAddress" value="${esc(myCard.address)}"></label><label class="full">服務項目<textarea id="cardServiceDescription" rows="4">${esc(myCard.serviceDescription)}</textarea></label><label>服務文字對齊<select id="cardServiceTextAlign"><option value="left" ${myCard.serviceTextAlign === "left" ? "selected" : ""}>靠左</option><option value="center" ${myCard.serviceTextAlign === "center" ? "selected" : ""}>置中</option><option value="right" ${myCard.serviceTextAlign === "right" ? "selected" : ""}>靠右</option></select></label><label class="full">名片封面圖片網址<input id="cardCoverUrl" type="url" placeholder="https://..." value="${esc(myCard.coverUrl)}"></label><div class="full card-buttons-setting"><div class="row"><strong>自訂按鈕</strong><button type="button" class="mini-btn" id="addCardButton">新增按鈕</button></div><div id="cardButtonRows">${(myCard.buttons || []).map(customButtonEditor).join("")}</div></div><button class="btn full" type="submit">儲存名片</button></form>`;
  if (view === "digital") {
    const selected = state.cardVersion && cardVersionMeta[state.cardVersion]
      ? { id:state.cardVersion, ...(myCard.versions?.[state.cardVersion] || {}), ...cardVersionMeta[state.cardVersion] }
      : activeCardVersion(myCard);
    panel = lineSourceEcardEditor(myCard, selected);
  }
  layout(`<section class="business-card"><div class="business-card-title"><button class="back-card" data-home-action="home" aria-label="返回首頁">←</button><h2>名片詳細資料</h2></div>${tabs}${panel}</section>`);
  document.querySelectorAll("[data-card-tab]").forEach((button) => button.onclick = () => { state.cardView = button.dataset.cardTab; card(); });
  bindPortalActions();
  if (view === "edit") {
    bindCardButtonEditor();
    $("#cardForm").onsubmit = async (event) => { event.preventDefault(); try {
      const updated = await api("/v1/cards/me", { method:"PUT", body:JSON.stringify({
        displayName: $("#cardDisplayName").value, englishName: $("#cardEnglishName").value, companyName: $("#cardCompanyName").value,
        jobTitle: $("#cardJobTitle").value, department: $("#cardDepartment").value, mobile: $("#cardMobile").value,
        companyPhone: $("#cardCompanyPhone").value, email: $("#cardEmail").value, websiteUrl: $("#cardWebsiteUrl").value,
        lineUrl: $("#cardLineUrl").value, address: $("#cardAddress").value, serviceDescription: $("#cardServiceDescription").value, serviceTextAlign: $("#cardServiceTextAlign").value,
        coverUrl: $("#cardCoverUrl").value, buttons: collectCardButtons(), versions:myCard.versions, selectedVersion:myCard.selectedVersion, status:"published"
      }) });
      state.cardView = "contact"; alert("名片已儲存"); await card();
    } catch (error) { alert(error.message); } };
  }
  if (view === "digital") {
    const selected = state.cardVersion && cardVersionMeta[state.cardVersion]
      ? { id:state.cardVersion, ...(myCard.versions?.[state.cardVersion] || {}), ...cardVersionMeta[state.cardVersion] }
      : activeCardVersion(myCard);
    new QRCode($("#cardPublicQr"), { text:cardPublicUrl(myCard.id), width:190, height:190 });
    $("#copyCardUrl").onclick = async () => { await navigator.clipboard.writeText(cardPublicUrl(myCard.id)); alert("名片網址已複製"); };
    $("#sharePersonalCard").onclick = () => sharePersonalCard(myCard).catch((error) => alert(error.message));
    $("#sendPersonalCard").onclick = () => sendPersonalCardToChat(myCard).catch((error) => alert(error.message));
    document.querySelectorAll('input[name="my-ecard-layout"]').forEach((input) => input.onchange = () => { state.cardVersion=input.value; state.cardView="digital"; card(); });
    const versionButtons = structuredClone(myCard.versions?.[selected.id]?.buttons || []);
    const updatePreview = () => { renderLineSourcePreview(myCard, selected); bindWysiwygCardCanvas(updatePreview); };
    renderLineSourceButtons(versionButtons, updatePreview); updatePreview();
    ["#my-v1-img-url", "#lineSourceTitle", "#lineSourceDescription", "#lineSourceDescriptionAlign"].forEach((selector) => {
      const field = $(selector);
      field?.addEventListener("input", updatePreview);
      field?.addEventListener("change", updatePreview);
    });
    $("#lineSourceAddButton").onclick = () => { if(versionButtons.length >= 4) return alert("最多可設定 4 個按鈕"); versionButtons.push({label:"新按鈕",type:"url",value:"",color:"#B96072"}); renderLineSourceButtons(versionButtons,updatePreview); updatePreview(); };
    $("#lineSourceImageFile").onchange = async () => { try { const file=$("#lineSourceImageFile").files?.[0]; if(!file) return; await openCardCropper(file,selected.id); } catch(e) { alert(e.message); } };
    $("#showMyCardQr").onclick = () => $("#cardPublicQr")?.scrollIntoView({behavior:"smooth",block:"center"});
    $("#btn-save-my-ecard").onclick = async () => { try { const id = selected.id; const versions = structuredClone(myCard.versions || {}); versions[id] = { ...(versions[id] || {}), coverUrl:$("#my-v1-img-url").value.trim(), title:$("#lineSourceTitle").value.trim(), description:$("#lineSourceDescription").value.trim(), descriptionTextAlign:$("#lineSourceDescriptionAlign").value, buttons:collectCardButtons(), buttonDefaultsSeeded:true }; await api("/v1/cards/me", { method:"PUT", body:JSON.stringify({ ...myCard, selectedVersion:id, versions, status:"published" }) }); alert("名片設定已儲存"); state.cardVersion=id; await card(); } catch(e) { alert(e.message); } };
  }
}
async function publicCard() {
  try {
    const result = await api(`/v1/cards/${encodeURIComponent(state.publicCard)}/public`);
    const shared = result.card;
    const actions = cardActionItems(shared);
    $("#app").innerHTML = `<section class="public-card-page">${shared.coverUrl ? `<img class="public-card-cover" src="${esc(shared.coverUrl)}" alt="${esc(shared.displayName)} 的名片">` : ""}<section class="public-card-body"><h1>${esc(shared.displayName)}</h1>${shared.englishName ? `<p class="muted">${esc(shared.englishName)}</p>` : ""}<h2>${esc(shared.companyName)}</h2><p>${esc([shared.jobTitle,shared.department].filter(Boolean).join("｜"))}</p>${shared.serviceDescription ? `<p class="public-card-service" style="text-align:${esc(shared.serviceTextAlign || "left")}">${esc(shared.serviceDescription)}</p>` : ""}${cardContactRows(shared)}<div class="business-card-contact-actions">${actions.map((item) => `<a href="${esc(item.value)}" ${item.type === "url" || item.type === "line" || item.type === "map" ? 'target="_blank" rel="noopener"' : ""}>${esc(item.label)}</a>`).join("")}</div><button class="btn alt" id="openMemberHome">開啟 MiraBeauty 會員中心</button></section>`;
    $("#openMemberHome").onclick = () => { state.publicCard = ""; history.replaceState({}, "", location.pathname); render(); };
  } catch (error) {
    $("#app").innerHTML = `<section class="center">${esc(error.message || "找不到這張名片")}</section>`;
  }
}
async function profile(required = false) {
  const ref = state.member.systemReferrer;
  const refText = ref
    ? `${ref.displayName || "會員"}${ref.memberNumber ? `（${ref.memberNumber}）` : ""}`
    : "無系統推薦人";
  layout(
    `<div class="card profile-card">${avatar()}<h2>${required ? "完成會員註冊" : "會員資料"}</h2><p class="muted">LINE 頭貼與名稱已自動帶入。請填寫直銷公司的會員編號；系統會員編號與系統推薦人不可自行修改。</p><label>姓名</label><input id="name" value="${esc(state.member.displayName)}" required><label>性別</label><select id="gender"><option value="">請選擇</option><option value="female" ${state.member.gender === "female" ? "selected" : ""}>女性</option><option value="male" ${state.member.gender === "male" ? "selected" : ""}>男性</option><option value="other" ${state.member.gender === "other" ? "selected" : ""}>其他</option><option value="prefer_not_to_say" ${state.member.gender === "prefer_not_to_say" ? "selected" : ""}>不透露</option></select><label>公司會員編號</label><input id="companyMemberNumber" value="${esc(state.member.companyMemberNumber)}" placeholder="請輸入直銷公司會員編號" required><label>系統會員編號</label><input value="${esc(state.member.memberNumber)}" readonly><label>系統推薦人</label><input value="${esc(refText)}" readonly><label>手機（選填）</label><input id="phone" value="${esc(state.member.phone)}"><button class="btn" id="save">${required ? "完成註冊" : "儲存"}</button>${required ? "" : `<button class="btn alt" id="logout">登出</button>`}</div>`,
  );
  $("#save").onclick = async () => {
    try {
      state.member = (
        await api("/v1/me", {
          method: "PATCH",
          body: JSON.stringify({
            displayName: $("#name").value,
            phone: $("#phone").value,
            gender: $("#gender").value,
            companyMemberNumber: $("#companyMemberNumber").value,
          }),
        })
      ).member;
      alert(required ? "註冊完成" : "已儲存");
      state.tab = state.courseSession ? "courses" : "home";
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  $("#logout")?.addEventListener("click", () => {
    localStorage.removeItem("mirabeauty_session");
    state.token = "";
    renderLogin();
  });
}
async function boot() {
  state.config = await (await fetch("/api/config")).json();
  await render();
}
boot().catch((e) => {
  $("#app").innerHTML =
    `<section class="center">系統載入失敗：${esc(e.message)}</section>`;
});
