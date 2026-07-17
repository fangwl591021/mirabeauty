const inviteFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("invite")) return params.get("invite");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("invite") || ""; }
  catch { return ""; }
};
const state = {
  config: null,
  token: localStorage.getItem("mirabeauty_session") || "",
  member: null,
  tab: new URLSearchParams(location.search).get("tab") === "daily" ? "daily" : "home",
  invite: inviteFromLocation() || sessionStorage.getItem("mirabeauty_invite") || "",
  daily: null,
};
const $ = (s) => document.querySelector(s);
let dailyRotationTimer = null;
if (inviteFromLocation()) sessionStorage.setItem("mirabeauty_invite", state.invite);
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
  const featureCopy = { wallet:["點數錢包","查看目前可用點數與交易紀錄。"], courses:["課程活動","查看課程、完成報名與簽到。"], daily:[state.daily?.campaign?.name || "簽到贈點活動",`向左滑動輪播卡；完成 ${Number(state.daily?.campaign?.requiredCreativeCount) || 0} 項觀看後，即可每日簽到。`], profile:["我的名片","管理你的會員資料與個人資訊。"] };
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
  if (!state.config.liffId) throw new Error("尚未設定 LIFF_ID");
  await liff.init({ liffId: state.config.liffId });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
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
  if (!state.token) return renderLogin();
  try {
    state.member = (await api("/v1/me")).member;
  } catch {
    state.token = "";
    localStorage.removeItem("mirabeauty_session");
    return renderLogin();
  }
  if (!state.member.profileCompletedAt) return profile(true);
  if (state.tab === "wallet") return wallet();
  if (state.tab === "courses") return courses();
  if (state.tab === "daily") return daily();
  if (state.tab === "profile") return profile();
  return home();
}
const portalMenu = () => `<section class="portal-menu portal-menu-compact" aria-label="會員功能"><button data-home-action="courses"><i class="portal-menu-icon navy">▣</i><span>課程活動</span></button><button data-home-action="daily"><i class="portal-menu-icon coral">♜</i><span>簽到贈點</span></button><button data-home-action="profile"><i class="portal-menu-icon pink">▤</i><span>我的名片</span></button><button data-home-action="home"><i class="portal-menu-icon green">⌂</i><span>首頁</span></button></section>`;
function bindPortalActions(){document.querySelectorAll("[data-home-action]").forEach((button)=>(button.onclick=async()=>{const action=button.dataset.homeAction;if(action==="share")return showShareQr();if(action==="walletqr"){const panel=$("#walletPanel");if(!panel){state.tab="wallet";return render()}$(".site-home-frame")?.classList.add("hidden");panel.classList.remove("hidden");panel.scrollIntoView({behavior:"smooth",block:"start"});return showWalletQr("homeWalletQr","homeWalletExpire")}state.tab=action==="home"?"home":action==="daily"?"daily":action==="courses"?"courses":action==="profile"?"profile":"wallet";await render()}));$("#copyInvite")?.addEventListener("click",copyInvite)}
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
  const cards = all.sessions.length
    ? all.sessions
        .map(
          (s) =>
            `<div class="card"><h3>${esc(s.courseTitle)}</h3><p>${esc(s.title || s.courseTitle)}</p><p class="muted">${esc(s.startsAt)}｜${s.mode === "physical" ? "現場" : "線上"}</p><button class="btn" data-register="${s.sessionId}" ${registered.has(s.sessionId) ? "disabled" : ""}>${registered.has(s.sessionId) ? "已報名" : "我要報名"}</button></div>`,
        )
        .join("")
    : '<div class="card muted">目前沒有公開課程</div>';
  layout(`<h2>課程活動</h2>${cards}`);
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
  const r = await api("/v1/daily-ad");
  if (!r.campaign) {
    layout('<div class="card">今天沒有輪播簽到活動。</div>');
    return;
  }
  state.daily = r;
  const completed = new Set(r.qualifiedCreativeIds || []);
  if (!r.creatives.length) {
    layout('<div class="card">此輪播活動尚未設定素材。</div>');
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
    // 百分比以會員前台 620px 容器為基準；不可使用 vw，否則桌機會被整個瀏覽器寬度放大。
    const bubbleWidths = { nano: "48%", micro: "56%", deca: "64%", hecto: "72%", kilo: "82%", mega: "92%", giga: "100%" };
    const bubbleWidth = bubbleWidths[creative.bubble_size] || bubbleWidths.nano;
    const detailLink = creative.image_link || creative.target_url;
    const media = `<div class="daily-media-frame" style="aspect-ratio:${esc(ratio)}"><${creative.creative_type === "video" ? "video controls playsinline" : "img"} class="daily-media" ${creative.creative_type === "video" ? "" : `alt="${esc(creative.title || `第 ${index + 1} 頁`)}"`} src="${esc(creative.media_url)}" style="object-fit:${mode}"></${creative.creative_type === "video" ? "video" : "img"}></div>`;
    const extraButtons = (creative.buttons || []).filter((button) => button.type === "uri" && button.uri).map((button) => `<a class="btn alt link-btn" target="_blank" rel="noopener" href="${esc(button.uri)}" ${button.color ? `style="background:${esc(button.color)};color:#fff"` : ""}>${esc(button.label)}</a>`).join("");
    const detailButton = detailLink ? `<a class="btn alt detail-button" target="_blank" rel="noopener" href="${esc(detailLink)}">詳細<br>說明</a>` : `<button class="btn alt detail-button" data-detail="${esc(creative.id)}">詳細<br>說明</button>`;
    const watchLabel = completed.has(creative.id) ? "已完成" : "開始<br>觀看";
    return `<article class="daily-slide ${completed.has(creative.id) ? "complete" : ""}" data-creative-id="${esc(creative.id)}" style="--bubble-width:${bubbleWidth}"><div class="daily-slide-head"><span>第 ${index + 1} 頁</span><span>${completed.has(creative.id) ? "已完成" : "待觀看"}</span></div>${media}<div class="daily-slide-body"><p class="muted">需保持本頁可見至少 ${creative.required_watch_seconds} 秒。</p><div class="daily-actions"><button class="btn watch-button" data-watch="${esc(creative.id)}" ${completed.has(creative.id) ? "disabled" : ""}>${watchLabel}</button>${detailButton}</div>${extraButtons ? `<div class="daily-extra-actions">${extraButtons}</div>` : ""}<p class="muted watch-status"></p></div></article>`;
  };
  layout(
    `<div class="daily-carousel" aria-label="每日輪播活動">${cards.map(cardHtml).join("")}</div><button class="btn ${r.checkedIn ? "alt" : ""}" id="checkin" ${r.checkedIn || r.qualifiedCreativeCount < r.campaign.requiredCreativeCount ? "disabled" : ""}>${r.checkedIn ? "今日已簽到" : `今日簽到（已完成 ${r.qualifiedCreativeCount}/${r.campaign.requiredCreativeCount} 項）`}</button><section id="walletPanel" class="card qr-card quick-panel hidden"><h3>我的點數錢包 QR 碼</h3><p class="muted">供現場人員掃描識別；每次產生後 60 秒失效。</p><div id="homeWalletQr" class="qr"></div><p id="homeWalletExpire" class="muted small"></p></section>`,
  );
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
      if (next >= carousel.scrollWidth - carousel.clientWidth - 8) {
        carousel.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        carousel.scrollTo({ left: next, behavior: "smooth" });
      }
    }, 4000);
  }
  $("#checkin").onclick = async () => {
    try {
      const x = await api("/v1/daily-ad/check-in", {
        method: "POST",
        body: "{}",
      });
      alert(x.duplicate ? "今天已簽到" : "簽到成功，點數已依規則處理");
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
      body: JSON.stringify({ creativeId: creative.id }),
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
      state.tab = "home";
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
