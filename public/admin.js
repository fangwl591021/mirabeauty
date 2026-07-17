const token = localStorage.getItem("mirabeauty_session") || "";
const $ = (selector) => document.querySelector(selector);
const api = async (path, body) => {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "操作失敗");
  return json;
};
const showStatus = (message, type = "ok") => {
  const box = $("#status");
  box.textContent = message;
  box.className = `status ${type}`;
  setTimeout(() => (box.className = "status hidden"), 5000);
};
const format = (value) =>
  new Intl.NumberFormat("zh-TW").format(Number(value) || 0);
async function loadAdminIdentity() {
  try {
    const { member } = await api("/v1/me");
    $("#adminName").textContent = member.displayName || "LINE 管理員";
    const avatar = $("#adminAvatar");
    if (member.pictureUrl) {
      avatar.src = member.pictureUrl;
      avatar.onerror = () => { avatar.style.display = "none"; };
    } else avatar.style.display = "none";
    $("#adminIdentity").hidden = false;
  } catch { /* overview will show the existing authorization error */ }
}
async function overview() {
  try {
    const data = await api("/v1/admin/overview");
    const x = data.overview;
    $("#metricMembers").textContent = format(x.members);
    $("#memberTotal").textContent = format(x.members);
    $("#metricPoints").textContent = format(x.issuedPoints);
    $("#metricCourses").textContent = format(x.publishedCourses);
    $("#metricCheckins").textContent = format(x.verifiedCheckins);
    return true;
  } catch (error) {
    showStatus(`無管理權限：${error.message}`, "error");
    return false;
  }
}
function switchPage(page) {
  document.body.classList.toggle("template-page", page === "carousel");
  document
    .querySelectorAll("[data-content]")
    .forEach((node) =>
      node.classList.toggle("active", node.dataset.content === page),
    );
  document
    .querySelectorAll("[data-page]")
    .forEach((node) =>
      node.classList.toggle("active", node.dataset.page === page),
    );
  const names = {
    dashboard: ["營運統計中心", "MiraBeauty 會員、點數與活動即時概況"],
    members: ["會員 CRM", "LINE Login 會員與推薦關係"],
    points: ["點數規則", "建立並管理各類贈點事件"],
    courses: ["課程／活動", "建立公開課程與簽到活動"],
    carousel: ["每日輪播贈點", "設定圖像、影片與觀看門檻"],
    settings: ["系統設定", "登入、點數錢包與導流設定"],
  };
  $("#pageTitle").textContent = names[page][0];
  $("#pageHint").textContent = names[page][1];
  if (page === "members") loadMembers();
  if (page === "carousel") loadCheckinTemplate();
  if (page === "points") loadPointRules();
}
let crmMembers = [];
const memberAvatar = (member) => member.picture_url ? `<img class="crm-avatar" src="${esc(member.picture_url)}" alt="">` : `<span class="crm-avatar crm-avatar-empty">${esc((member.display_name || "會").slice(0, 1))}</span>`;
const crmStatus = (member) => member.profile_completed_at ? '<span class="crm-tag ok">已完成註冊</span>' : '<span class="crm-tag">待完成註冊</span>';
function renderMembers() {
  const query = String($("#memberSearch")?.value || "").trim().toLowerCase();
  const filtered = crmMembers.filter((member) => [member.display_name, member.phone, member.member_number, member.id, member.email].join(" ").toLowerCase().includes(query));
  $("#memberTotal").textContent = format(crmMembers.length);
  $("#memberList").innerHTML = filtered.length ? filtered.map((member) => `<tr><td><div class="crm-member">${memberAvatar(member)}<div><b>${esc(member.display_name || "未命名會員")}</b><small>${esc(member.phone || member.email || member.id)}</small></div></div></td><td>${esc(member.member_number || "–")}</td><td>${esc(member.referrer_name || "直接加入")}<small>${esc(member.referrer_member_number || "")}</small></td><td><b class="crm-points">${format(member.points_balance)}</b></td><td>${crmStatus(member)}</td><td>${esc(String(member.created_at || "").replace("T", " ").slice(0, 16))}</td><td><button class="crm-open" data-member-id="${esc(member.id)}">CRM 檔案</button></td></tr>`).join("") : '<tr><td colspan="7" class="crm-empty">找不到符合條件的會員</td></tr>';
  document.querySelectorAll("[data-member-id]").forEach((button) => { button.onclick = () => openMemberDetail(button.dataset.memberId); });
}
async function loadMembers() {
  const list = $("#memberList");
  if (!list) return;
  list.innerHTML = '<tr><td colspan="7" class="crm-empty">載入會員資料中…</td></tr>';
  try {
    const data = await api("/v1/admin/members");
    crmMembers = data.members || [];
    renderMembers();
  } catch (error) {
    list.innerHTML = `<tr><td colspan="7" class="crm-empty danger">${esc(error.message)}</td></tr>`;
  }
}
async function openMemberDetail(id) {
  const panel = $("#memberDetail");
  panel.classList.remove("hidden");
  panel.innerHTML = '<div class="crm-empty">載入 CRM 檔案中…</div>';
  try {
    const data = await api(`/v1/admin/members/${encodeURIComponent(id)}`);
    const member = data.member;
    const items = (title, rows, render) => `<section class="crm-detail-section"><h3>${title}</h3>${rows.length ? `<div class="crm-records">${rows.map(render).join("")}</div>` : '<p class="muted">尚無紀錄</p>'}</section>`;
    panel.innerHTML = `<div class="crm-detail-head"><div class="crm-member">${memberAvatar(member)}<div><h2>${esc(member.display_name || "未命名會員")}</h2><small>${esc(member.member_number || member.id)}</small></div></div><button class="secondary" id="closeMemberDetail">關閉</button></div><div class="crm-summary"><div><small>目前點數</small><b class="crm-points">${format(member.points_balance)}</b></div><div><small>推薦人</small><b>${esc(member.referrer_name || "直接加入")}</b></div><div><small>聯絡電話</small><b>${esc(member.phone || "未填寫")}</b></div><div><small>註冊狀態</small>${crmStatus(member)}</div></div><div class="crm-detail-grid">${items("點數紀錄", data.ledger, (row) => `<div><b>${esc(ruleEventLabel[row.event_type] || row.event_type)}</b><span class="${Number(row.delta) >= 0 ? "crm-plus" : "crm-minus"}">${Number(row.delta) >= 0 ? "+" : ""}${row.delta}</span><small>${esc(row.created_at)}</small></div>`)}${items("課程／活動", data.courses, (row) => `<div><b>${esc(row.title)}</b><span>${esc(row.status)}</span><small>${esc(row.starts_at)}</small></div>`)}${items("每日簽到", data.checkins, (row) => `<div><b>${esc(row.business_date)}</b><span>${esc(row.status)}</span><small>${esc(row.checked_in_at)}</small></div>`)}${items("成功邀約", data.referrals, (row) => `<div><b>${esc(row.display_name || "新會員")}</b><span>${esc(row.member_number || "")}</span><small>${esc(row.created_at)}</small></div>`)}</div>`;
    $("#closeMemberDetail").onclick = () => panel.classList.add("hidden");
    panel.scrollIntoView({ behavior:"smooth", block:"start" });
  } catch (error) {
    panel.innerHTML = `<p class="danger">${esc(error.message)}</p>`;
  }
}
const localIso = (value) => (value ? new Date(value).toISOString() : "");
async function submitForm(event, endpoint, body) {
  event.preventDefault();
  try {
    const result = await api(endpoint, body());
    event.target.reset();
    showStatus(`建立完成，ID：${result.id}`);
  } catch (error) {
    showStatus(error.message, "error");
  }
}
document
  .querySelectorAll("[data-page]")
  .forEach((button) =>
    button.addEventListener("click", () => switchPage(button.dataset.page)),
  );
document
  .querySelectorAll("[data-go]")
  .forEach((button) =>
    button.addEventListener("click", () => switchPage(button.dataset.go)),
  );
$("#refresh").addEventListener("click", () =>
  overview().then((ok) => ok && showStatus("資料已重新同步")),
);
$("#refreshMembers").addEventListener("click", loadMembers);
$("#memberSearch").addEventListener("input", renderMembers);
$("#logout").addEventListener("click", () => {
  localStorage.removeItem("mirabeauty_session");
  location.href = "/";
});
$("#ruleForm").addEventListener("submit", (event) =>
  submitForm(event, "/v1/admin/point-rules", () => ({
    eventType: $("#ruleEvent").value.trim(),
    points: Number($("#rulePoints").value),
    awardFrequency: $("#ruleFrequency").value,
    status: $("#ruleStatus").value,
  })).then(() => loadPointRules()),
);
const ruleFrequencyLabel = { once:"僅一次", daily:"每日一次", per_completion:"完成給一次" };
const ruleEventLabel = { member_joined:"加入會員", registration_completed:"完成註冊", share_referral:"分享邀約成功", daily_ad_checkin:"簽到打卡", course_registered:"課程報名", attendance_verified:"課程簽到", task_completed:"任務完成", daily_ad_view:"簽到觀看", daily_ad_view_completed:"簽到觀看", daily_view:"簽到觀看" };
async function loadPointRules() {
  const container = $("#ruleList");
  if (!container) return;
  try {
    const data = await api("/v1/admin/point-rules");
    const fixedOnce = new Set(["member_joined", "registration_completed"]);
    container.innerHTML = data.rules.length ? data.rules.map((rule) => {
      const fixed = fixedOnce.has(rule.event_type);
      return `<form class="rule-row" data-rule-id="${rule.id}"><div class="rule-event" data-event-type="${rule.event_type}">${ruleEventLabel[rule.event_type] || rule.event_type}<small>${rule.event_type}</small></div><label>點數<input data-rule-field="points" type="number" min="0" value="${Number(rule.points)}"></label><label>發點頻率<select data-rule-field="frequency">${Object.entries(ruleFrequencyLabel).map(([key,label]) => `<option value="${key}" ${rule.award_frequency === key ? "selected" : ""} ${fixed && key !== "once" ? "disabled" : ""}>${label}</option>`).join("")}</select></label><label>狀態<select data-rule-field="status">${["draft","active","paused","archived"].map((value) => `<option value="${value}" ${rule.status === value ? "selected" : ""}>${value === "draft" ? "草稿" : value === "active" ? "啟用" : value === "paused" ? "暫停" : "封存"}</option>`).join("")}</select></label><button class="rule-save" type="submit">儲存</button></form>`;
    }).join("") : '<p class="muted">尚未建立點數規則。</p>';
  } catch (error) {
    container.innerHTML = `<p class="danger">${error.message}</p>`;
  }
}
$("#ruleList").addEventListener("submit", async (event) => {
  const form = event.target.closest(".rule-row");
  if (!form) return;
  event.preventDefault();
  try {
    await api(`/v1/admin/point-rules/${form.dataset.ruleId}`, {
      eventType: form.querySelector(".rule-event").dataset.eventType,
      points: Number(form.querySelector('[data-rule-field="points"]').value),
      awardFrequency: form.querySelector('[data-rule-field="frequency"]').value,
      status: form.querySelector('[data-rule-field="status"]').value,
    });
    showStatus("點數規則已儲存");
    loadPointRules();
  } catch (error) {
    showStatus(error.message, "error");
  }
});
$("#refreshRules").addEventListener("click", loadPointRules);
$("#reconcilePoints").addEventListener("click", async () => {
  const button = $("#reconcilePoints");
  if (!confirm("將依目前啟用規則補發尚未入帳的既有完成條件；已入帳資料不會重複發點。是否繼續？")) return;
  button.disabled = true;
  button.textContent = "補發中…";
  try {
    const result = await api("/v1/admin/point-rules/reconcile", {});
    showStatus(`補發完成：新增 ${result.awarded} 筆，略過 ${result.skipped} 筆。`);
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "補發既有完成條件";
  }
});
$("#courseForm").addEventListener("submit", (event) =>
  submitForm(event, "/v1/admin/courses", () => ({
    title: $("#courseTitle").value.trim(),
    description: $("#courseDesc").value.trim(),
    status: $("#courseStatus").value,
  })),
);
const templateButtons = (value) =>
  String(value || "")
    .split("\n")
    .map((line) => line.split("｜"))
    .map(([label, uri]) => ({
      label: (label || "").trim(),
      type: "uri",
      uri: (uri || "").trim(),
    }))
    .filter((button) => button.label && button.uri)
    .slice(0, 4);
$("#campaignForm")?.addEventListener("submit", (event) =>
  submitForm(event, "/v1/admin/ad-campaigns", () => ({
    name: $("#campaignName").value.trim(),
    startsAt: localIso($("#campaignStart").value),
    endsAt: localIso($("#campaignEnd").value),
    requiredCreativeCount: Number($("#campaignCount").value),
    rotationMode: $("#campaignRotation").value,
    status: $("#campaignStatus").value,
  })),
);
$("#creativeForm")?.addEventListener("submit", (event) =>
  submitForm(event, "/v1/admin/ad-creatives", () => ({
    campaignId: $("#creativeCampaign").value.trim(),
    type: $("#creativeType").value,
    title: $("#creativeTitle").value.trim(),
    mediaUrl: $("#creativeUrl").value.trim(),
    imageLink: $("#creativeImageLink").value.trim(),
    bubbleSize: $("#creativeBubbleSize").value,
    imageAspectRatio: $("#creativeAspectRatio").value.trim(),
    imageAspectMode: $("#creativeAspectMode").value,
    buttons: templateButtons($("#creativeButtons").value),
    requiredWatchSeconds: Number($("#creativeSeconds").value),
  })),
);
overview();
loadAdminIdentity();

// Exact port of the MLM checkin-template editor; only its storage endpoint is MiraBeauty.
let checkinTemplateDraft = null;
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
const sizes = ["nano","micro","deca","hecto","kilo","mega","giga"];
const validSize = (x) => sizes.includes(String(x || "").toLowerCase()) ? String(x).toLowerCase() : "nano";
const validRatio = (x) => /^\d{1,4}:\d{1,4}$/.test(String(x || "").replace(/[：]/g, ":")) ? String(x).replace(/[：]/g, ":") : "400:600";
const validMode = (x) => String(x).toLowerCase() === "fit" ? "fit" : "cover";
const validRotation = (x) => String(x).toLowerCase() === "sequential" ? "sequential" : "random";
const defaultButton = () => ({ label:"開啟連結", type:"uri", text:"", uri:"", color:"" });
const defaultPage = () => ({imageUrl:"",imageLink:"",bubbleSize:"nano",imageAspectRatio:"400:600",imageAspectMode:"cover",buttons:[]});
const dailyEntryUrl = () => `${location.origin}/?tab=daily`;
const defaultTemplate = () => ({active:true,altText:"簽到贈點活動",rotationMode:"random",pages:[defaultPage()]});
function normalizeTemplate(data = {}) { const base=defaultTemplate(); return { active:data.active !== false, altText:String(data.altText || base.altText), rotationMode:validRotation(data.rotationMode), pages:(Array.isArray(data.pages)&&data.pages.length?data.pages:base.pages).slice(0,12).map(p=>({imageUrl:String(p.imageUrl||""),imageLink:String(p.imageLink||""),bubbleSize:validSize(p.bubbleSize),imageAspectRatio:validRatio(p.imageAspectRatio),imageAspectMode:validMode(p.imageAspectMode),buttons:(Array.isArray(p.buttons)?p.buttons:[]).slice(0,4).map(b=>({label:String(b.label||"按鈕"),type:"uri",text:"",uri:String(b.uri||""),color:String(b.color||"")}))})) }; }
function pageHtml(page, index, collapsed=false) { const opts=(values,current)=>values.map(v=>`<option value="${v}" ${v===current?"selected":""}>${v}</option>`).join(""); return `<div class="templatePage${collapsed?" collapsed":""}" data-page-index="${index}"><div class="templatePageHead"><strong>第 ${index+1} 頁 <span class="template-muted">400 x 600（LINE 2:3）</span></strong><button type="button" class="dangerButton" data-template-action="remove-page" ${index===0?"disabled":""}>刪除頁面</button></div><div class="templateImageUpload"><div class="templateUploadRow"><label>上傳圖片<input data-field="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label><a href="${esc(page.imageUrl||"#")}" target="_blank" rel="noopener">查看圖片</a></div><input data-field="imageUrl" type="url" value="${esc(page.imageUrl)}" placeholder="上傳後自動產生圖片 URL，也可貼 HTTPS 圖片網址" /><div class="templateImageStatus">圖片依下方比例裁切預覽；建議尺寸 400 x 600，檔案 1MB 內。</div></div><div class="templateGrid"><label>詳細說明連結<input data-field="imageLink" type="url" value="${esc(page.imageLink)}" placeholder="可空白；空白時詳細說明會放大圖片" /></label><label>卡片 Size<select data-field="bubbleSize">${opts(sizes,page.bubbleSize)}</select></label><label>圖片比例<input data-field="imageAspectRatio" type="text" value="${esc(validRatio(page.imageAspectRatio))}" /></label><label>圖片模式<select data-field="imageAspectMode">${opts(["cover","fit"],page.imageAspectMode)}</select></label></div><div class="templateButtons">${page.buttons.map((b,i)=>buttonHtml(b,i)).join("")}</div><div style="margin-top:10px"><button type="button" class="secondaryButton" data-template-action="add-button">新增 button</button></div></div>`; }
function buttonHtml(button,index) { const color=/^#[0-9a-f]{6}$/i.test(button.color)?button.color:"#06C755"; return `<div class="templateButton" data-button-index="${index}"><div class="templateButtonGrid templateLinkButtonGrid"><label>按鈕文字<input data-field="label" value="${esc(button.label)}" /></label><label>連結 URL<input data-field="uri" type="url" value="${esc(button.uri)}" placeholder="https://..." /></label><label>顏色<div class="templateColorRow"><input data-field="colorPicker" type="color" value="${color}" /><input data-field="color" value="${esc(button.color)}" placeholder="#06C755" /></div></label><button type="button" class="dangerButton" data-template-action="remove-button">刪除</button></div></div>`; }
function collapsedTemplatePages(){return [...document.querySelectorAll("#templatePages .templatePage.collapsed")].map(page=>Number(page.dataset.pageIndex))}
function renderCheckinTemplate(template, collapsedPages=[]) { const t=normalizeTemplate(template); checkinTemplateDraft=t; $("#templateActive").checked=t.active; $("#templateEntryUrl").value=dailyEntryUrl(); $("#templateAltText").value=t.altText; $("#templateRotationMode").value=t.rotationMode; $("#templatePages").innerHTML=t.pages.map((page,index)=>pageHtml(page,index,collapsedPages.includes(index))).join(""); renderTemplatePageToggles(); refreshTemplatePreview(); }
function collectTemplate() { const pages=[...document.querySelectorAll("#templatePages .templatePage")].map(page=>{const v=k=>String(page.querySelector(`[data-field="${k}"]`)?.value||"").trim();return {imageUrl:v("imageUrl"),imageLink:v("imageLink"),bubbleSize:validSize(v("bubbleSize")),imageAspectRatio:validRatio(v("imageAspectRatio")),imageAspectMode:validMode(v("imageAspectMode")),buttons:[...page.querySelectorAll(".templateButton")].map(button=>{const b=k=>String(button.querySelector(`[data-field="${k}"]`)?.value||"").trim();return {label:b("label")||"按鈕",type:"uri",text:"",uri:b("uri"),color:b("color")}}).filter(b=>b.label&&b.uri)};});return {active:$("#templateActive").checked,entryUrl:$("#templateEntryUrl").value.trim(),altText:$("#templateAltText").value.trim()||"簽到贈點活動",rotationMode:validRotation($("#templateRotationMode").value),pages}; }
function flexPreview(t) { return {type:"flex",altText:t.altText,contents:{type:"carousel",contents:t.pages.map(p=>({type:"bubble",size:p.bubbleSize,body:{type:"box",layout:"vertical",contents:[{type:"image",url:p.imageUrl,size:"full",aspectMode:p.imageAspectMode,aspectRatio:p.imageAspectRatio,gravity:"top",...(p.imageLink?{action:{type:"uri",uri:p.imageLink}}:{})}],paddingAll:"0px"},...(p.buttons.length?{footer:{type:"box",layout:"vertical",contents:p.buttons.map(b=>({type:"button",style:"primary",color:b.color||"#06C755",action:b.type==="uri"?{type:"uri",label:b.label,uri:b.uri}:{type:"message",label:b.label,text:b.text}}))}}:{})}))}}; }
function refreshTemplatePreview(){ const t=collectTemplate(); const view=t.pages.length?t:checkinTemplateDraft||defaultTemplate(); $("#templatePreview").textContent=JSON.stringify(flexPreview(view).contents,null,2); $("#templateVisualPreview").innerHTML=view.pages.map((p,i)=>`<div class="templatePhone"><div class="templatePhoneImage">${p.imageUrl?`<img src="${esc(p.imageUrl)}" alt="第 ${i+1} 頁圖片">`:`<span>上傳第 ${i+1} 頁圖片</span>`}</div><div class="templatePhoneFooter">${p.buttons.map(b=>`<div class="templatePhoneButton" style="background:${esc(/^#[0-9a-f]{6}$/i.test(b.color)?b.color:"#06C755")}">${esc(b.label)}</div>`).join("")||'<span class="template-muted">尚未設定按鈕</span>'}</div></div>`).join(""); }
function templateStatus(message, ok){const a=$("#templateStatus"),b=$("#templateInlineStatus");for(const x of [a,b]){x.textContent=message||"";x.className=`${x===a?"templateStatus":"templateInlineStatus"} ${ok?"ok":"bad"}`}}
async function loadCheckinTemplate(){try{const data=await api("/v1/admin/checkin-template");renderCheckinTemplate(data.template||defaultTemplate())}catch(error){templateStatus(error.message,false)}}
async function saveCheckinTemplate(){const t=collectTemplate(),collapsed=collapsedTemplatePages();if(!t.entryUrl||!t.pages.length||t.pages.some(p=>!p.imageUrl))return templateStatus("請填寫活動入口網址，並為每一頁上傳圖片或貼上 HTTPS 圖片網址。",false);const button=$("#templateSave");button.disabled=true;button.textContent="儲存中...";try{const data=await api("/v1/admin/checkin-template",t);renderCheckinTemplate(data.template||t,collapsed);templateStatus("已儲存模板，已建立新的觀看內容。",true)}catch(error){templateStatus(error.message,false)}finally{button.disabled=false;button.textContent="儲存模板"}}
async function optimizeTemplateImage(file){const target=900*1024;if(file.size<=target)return file;if(!globalThis.createImageBitmap)throw new Error("此瀏覽器無法自動壓縮圖片");const source=await createImageBitmap(file);try{let scale=Math.min(1,1200/Math.max(source.width,source.height)),best=null;for(let pass=0;pass<4;pass+=1){const width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale)),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;canvas.getContext("2d").drawImage(source,0,0,width,height);for(const quality of [.86,.76,.66,.56]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));if(!blob)continue;best=blob;if(blob.size<=target)return new File([blob],`${file.name.replace(/\.[^.]+$/,"")||"carousel"}.webp`,{type:"image/webp"})}scale*=.72}if(!best||best.size>1024*1024)throw new Error("圖片壓縮後仍超過 1MB，請使用較小圖片");return new File([best],`${file.name.replace(/\.[^.]+$/,"")||"carousel"}.webp`,{type:"image/webp"})}finally{source.close?.()}}
async function uploadTemplateImage(input){const original=input.files?.[0],page=input.closest(".templatePage"),field=page?.querySelector('[data-field="imageUrl"]'),status=page?.querySelector(".templateImageStatus");if(!original||!field)return;try{status.textContent=original.size>900*1024?"圖片壓縮中...":"圖片上傳中...";const file=await optimizeTemplateImage(original);field.value=URL.createObjectURL(file);refreshTemplatePreview();const form=new FormData();form.append("image",file,file.name);status.textContent=`上傳中（${Math.round(original.size/1024)} KB → ${Math.round(file.size/1024)} KB）...`;const res=await fetch("/v1/admin/checkin-template/upload-image",{method:"POST",headers:{authorization:`Bearer ${token}`},body:form});const json=await res.json();if(!res.ok)throw new Error(json.error||"圖片上傳失敗");field.value=json.url;status.textContent=`已上傳：${Math.round(original.size/1024)} KB → ${Math.round(json.size/1024)} KB`;refreshTemplatePreview()}catch(error){status.textContent=`上傳失敗：${error.message||"請改用 JPG、PNG 或 WebP 圖片"}`}}
function renderTemplatePageToggles(){document.querySelectorAll(".templatePageHead").forEach(head=>{if(head.querySelector("[data-template-toggle]"))return;const toggle=document.createElement("button");toggle.type="button";toggle.className="secondaryButton template-toggle";toggle.dataset.templateToggle="1";toggle.textContent=head.closest(".templatePage")?.classList.contains("collapsed")?"展開設定":"收合設定";head.insertBefore(toggle,head.querySelector(".dangerButton"));toggle.onclick=()=>{const page=head.closest(".templatePage"),collapsed=page.classList.toggle("collapsed");toggle.textContent=collapsed?"展開設定":"收合設定"}})}
$("#templateAddPage").addEventListener("click",()=>{const t=collectTemplate(),collapsed=collapsedTemplatePages();t.pages.push(defaultPage());renderCheckinTemplate(t,collapsed);templateStatus(`已新增第 ${t.pages.length} 頁，請上傳圖片。`,true)});$("#templateSave").addEventListener("click",saveCheckinTemplate);$("#templatePages").addEventListener("input",refreshTemplatePreview);$("#templatePages").addEventListener("change",async e=>{if(e.target.matches('[data-field="colorPicker"]'))e.target.closest(".templateColorRow").querySelector('[data-field="color"]').value=e.target.value.toUpperCase();if(e.target.matches('[data-field="imageFile"]'))await uploadTemplateImage(e.target);refreshTemplatePreview()});$("#templatePages").addEventListener("click",e=>{const button=e.target.closest("[data-template-action]");if(!button)return;const t=collectTemplate(),page=button.closest(".templatePage"),i=Number(page?.dataset.pageIndex),collapsed=collapsedTemplatePages();if(button.dataset.templateAction==="add-button")t.pages[i].buttons.push(defaultButton());if(button.dataset.templateAction==="remove-page"&&i>0){t.pages.splice(i,1);renderCheckinTemplate(t,collapsed.filter(x=>x!==i).map(x=>x>i?x-1:x));return}if(button.dataset.templateAction==="remove-button"){const j=Number(button.closest(".templateButton")?.dataset.buttonIndex);if(j>=0)t.pages[i].buttons.splice(j,1)}renderCheckinTemplate(t,collapsed)});["#templateEntryUrl","#templateAltText","#templateRotationMode","#templateActive"].forEach(id=>$(id).addEventListener("input",refreshTemplatePreview));
$("#copyTemplateEntry").addEventListener("click", async () => { await navigator.clipboard.writeText(dailyEntryUrl()); templateStatus("活動入口網址已複製。", true); });
