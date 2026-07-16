const state = {
  config: null,
  token: localStorage.getItem("mirabeauty_session") || "",
  member: null,
  tab: new URLSearchParams(location.search).get("tab") === "daily" ? "daily" : "home",
  invite: new URLSearchParams(location.search).get("invite") || "",
  daily: null,
};
const $ = (s) => document.querySelector(s);
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
function avatar(member = state.member) {
  return member?.pictureUrl
    ? `<img class="avatar" src="${esc(member.pictureUrl)}" alt="LINE 頭貼">`
    : `<span class="avatar placeholder">${esc((member?.displayName || "L").slice(0, 1))}</span>`;
}
function layout(body) {
  $("#app").innerHTML =
    `<header class="hero member-hero">${avatar()}<div><h1>MiraBeauty 會員中心</h1><p>${esc(state.member?.displayName || "LINE 會員")}，歡迎回來</p></div></header><div class="content">${body}</div><nav class="nav">${[
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
}
async function login() {
  if (!state.config.liffId) throw new Error("尚未設定 LIFF_ID");
  await liff.init({ liffId: state.config.liffId });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    return;
  }
  const idToken = liff.getIDToken();
  const lineProfile = await liff.getProfile().catch(() => null);
  const r = await api("/v1/auth/line/verify", {
    method: "POST",
    body: JSON.stringify({
      idToken,
      inviteToken: state.invite,
      pictureUrl: lineProfile?.pictureUrl || "",
      displayName: lineProfile?.displayName || "",
    }),
  });
  state.token = r.sessionToken;
  localStorage.setItem("mirabeauty_session", state.token);
  state.member = r.member;
  history.replaceState({}, "", state.tab === "daily" ? `${location.pathname}?tab=daily` : location.pathname);
  await render();
}
async function renderLogin() {
  const inviteNotice = state.invite
    ? `<div class="notice">請先加入官方帳號，再以 LINE 登入完成註冊。<br><br><a class="btn" href="${state.config.officialAccountUrl}" target="_blank">加入官方帳號</a><br><br><button class="btn alt" id="continue">我已加入，繼續登入</button></div>`
    : "";
  $("#app").innerHTML =
    `<section class="hero"><h1>MiraBeauty 會員中心</h1><p>登入、點數、課程與每日任務</p></section><div class="content">${inviteNotice}<div class="card"><h2>使用 LINE 登入</h2><p class="muted">以 LINE 身份建立你的會員、邀約與點數紀錄。</p><button class="btn" id="login">LINE Login</button></div></div>`;
  $("#login").onclick = () => login().catch((e) => alert(e.message));
  $("#continue")?.addEventListener("click", () =>
    login().catch((e) => alert(e.message)),
  );
}
async function render() {
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
async function home() {
  const wallet = await api("/v1/points/wallet");
  layout(
    `<div class="card"><div class="muted">目前可用點數</div><div class="points">${wallet.wallet.balance}</div><button class="btn alt" id="toWallet">開啟點數錢包</button></div><div class="grid"><button class="btn" id="share">分享 QR 碼</button><button class="btn dark" id="dailyBtn">每日簽到</button></div><div class="card qr-card"><h3>我的分享 QR 碼</h3><p class="muted">朋友掃描後會帶入你的系統推薦關係。</p><div id="shareQr" class="qr"></div><button class="btn alt" id="copyInvite">複製邀約連結</button></div><div class="card qr-card"><h3>我的點數錢包 QR 碼</h3><p class="muted">供現場人員掃描識別；每次產生後 60 秒失效。</p><div id="homeWalletQr" class="qr"></div><button class="btn dark" id="homeWallet">顯示點數 QR 碼</button><p id="homeWalletExpire" class="muted small"></p></div>`,
  );
  $("#toWallet").onclick = () => {
    state.tab = "wallet";
    render();
  };
  $("#dailyBtn").onclick = () => {
    state.tab = "daily";
    render();
  };
  $("#share").onclick = showShareQr;
  $("#copyInvite").onclick = copyInvite;
  $("#homeWallet").onclick = () =>
    showWalletQr("homeWalletQr", "homeWalletExpire");
}
async function invite() {
  return api("/v1/invite-links", { method: "POST", body: "{}" });
}
async function showShareQr() {
  const r = await invite();
  $("#shareQr").innerHTML = "";
  new QRCode($("#shareQr"), { text: r.invite.url, width: 210, height: 210 });
  $("#shareQr").dataset.url = r.invite.url;
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
    `<div class="card"><div class="muted">${esc(r.wallet.programName)}</div><div class="points">${r.wallet.balance}</div><button class="btn" id="walletQr">顯示動態錢包 QR Code</button><div id="qr" class="qr"></div><p id="expire" class="muted small"></p></div><div class="card"><h3>點數明細</h3>${r.wallet.entries.length ? r.wallet.entries.map((x) => `<div class="item"><b>${esc(x.event_type)}</b><span class="row"><span class="muted">${esc(x.created_at)}</span><b>+${x.delta}</b></span></div>`).join("") : '<p class="muted">尚無點數紀錄</p>'}</div>`,
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
  const r = await api("/v1/daily-ad");
  if (!r.campaign) {
    layout('<div class="card">今天沒有輪播簽到活動。</div>');
    return;
  }
  state.daily = r;
  const completed = new Set(r.qualifiedCreativeIds || []);
  const pending = r.creatives.filter((c) => !completed.has(c.id));
  const pool = pending.length ? pending : r.creatives;
  const creative =
    r.campaign.rotationMode === "random"
      ? pool[Math.floor(Math.random() * pool.length)]
      : pool[0];
  if (!creative) {
    layout('<div class="card">此輪播活動尚未設定素材。</div>');
    return;
  }
  const position = Math.min(
    r.qualifiedCreativeCount + 1,
    r.campaign.requiredCreativeCount,
  );
  const cardLink = creative.image_link || creative.target_url;
  const templateButtons = (creative.buttons || [])
    .filter((button) => button.type === "uri" && button.uri)
    .map(
      (button) =>
        `<a class="btn alt link-btn" target="_blank" rel="noopener" href="${esc(button.uri)}" ${button.color ? `style="background:${esc(button.color)};color:#fff"` : ""}>${esc(button.label)}</a>`,
    )
    .join("");
  const media =
    creative.creative_type === "video"
      ? `<video id="adMedia" controls playsinline src="${esc(creative.media_url)}"></video>`
      : `<img id="adMedia" src="${esc(creative.media_url)}" alt="${esc(creative.title)}">`;
  layout(
    `<h2>${esc(r.campaign.name)}</h2><p class="muted">完成 ${r.campaign.requiredCreativeCount} 項素材觀看後，即可每日簽到。</p><div class="carousel-progress">${r.creatives.map((c) => `<span class="${completed.has(c.id) ? "done" : ""}"></span>`).join("")}</div><div class="card ad carousel"><div class="content"><span class="muted">第 ${position} 項任務｜${r.campaign.rotationMode === "random" ? "隨機輪動" : "順序輪動"}</span><h3>${esc(creative.title || "今日輪播內容")}</h3></div>${cardLink ? `<a target="_blank" rel="noopener" href="${esc(cardLink)}">${media}</a>` : media}<div class="content"><p class="muted">需保持本頁可見至少 ${creative.required_watch_seconds} 秒。</p><button class="btn" id="startWatch">開始觀看</button><p id="watchStatus" class="muted"></p>${templateButtons}</div></div><button class="btn ${r.checkedIn ? "alt" : ""}" id="checkin" ${r.checkedIn || r.qualifiedCreativeCount < r.campaign.requiredCreativeCount ? "disabled" : ""}>${r.checkedIn ? "今日已簽到" : `今日簽到（已完成 ${r.qualifiedCreativeCount}/${r.campaign.requiredCreativeCount} 項）`}</button>`,
  );
  $("#startWatch").onclick = () => watchCreative(creative);
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
async function watchCreative(creative) {
  const button = $("#startWatch");
  button.disabled = true;
  const status = $("#watchStatus");
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
      const media = $("#adMedia");
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
      $("#adMedia")
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
    `<div class="card profile-card">${avatar()}<h2>${required ? "完成會員註冊" : "會員資料"}</h2><p class="muted">LINE 頭貼與名稱已自動帶入；會員編號與系統推薦人不可自行修改。</p><label>姓名</label><input id="name" value="${esc(state.member.displayName)}" required><label>性別</label><select id="gender"><option value="">請選擇</option><option value="female" ${state.member.gender === "female" ? "selected" : ""}>女性</option><option value="male" ${state.member.gender === "male" ? "selected" : ""}>男性</option><option value="other" ${state.member.gender === "other" ? "selected" : ""}>其他</option><option value="prefer_not_to_say" ${state.member.gender === "prefer_not_to_say" ? "selected" : ""}>不透露</option></select><label>會員編號</label><input value="${esc(state.member.memberNumber)}" readonly><label>系統推薦人</label><input value="${esc(refText)}" readonly><label>手機（選填）</label><input id="phone" value="${esc(state.member.phone)}"><button class="btn" id="save">${required ? "完成註冊" : "儲存"}</button>${required ? "" : `<button class="btn alt" id="logout">登出</button>`}</div>`,
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
