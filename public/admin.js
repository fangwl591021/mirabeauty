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
  if (page === "carousel") loadCheckinTemplate();
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
$("#logout").addEventListener("click", () => {
  localStorage.removeItem("mirabeauty_session");
  location.href = "/";
});
$("#ruleForm").addEventListener("submit", (event) =>
  submitForm(event, "/v1/admin/point-rules", () => ({
    eventType: $("#ruleEvent").value.trim(),
    points: Number($("#rulePoints").value),
    status: $("#ruleStatus").value,
  })),
);
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
const defaultButton = (type = "message") => ({ label:type === "uri" ? "開啟連結" : "簽到贈點", type, text:type === "uri" ? "" : "會員打卡", uri:"", color:"" });
const defaultPage = () => ({imageUrl:"",imageLink:"",bubbleSize:"nano",imageAspectRatio:"400:600",imageAspectMode:"cover",buttons:[defaultButton()]});
const dailyEntryUrl = () => `${location.origin}/?tab=daily`;
const defaultTemplate = () => ({active:true,altText:"簽到贈點活動",rotationMode:"random",pages:[defaultPage()]});
function normalizeTemplate(data = {}) { const base=defaultTemplate(); return { active:data.active !== false, altText:String(data.altText || base.altText), rotationMode:validRotation(data.rotationMode), pages:(Array.isArray(data.pages)&&data.pages.length?data.pages:base.pages).slice(0,12).map(p=>({imageUrl:String(p.imageUrl||""),imageLink:String(p.imageLink||""),bubbleSize:validSize(p.bubbleSize),imageAspectRatio:validRatio(p.imageAspectRatio),imageAspectMode:validMode(p.imageAspectMode),buttons:(Array.isArray(p.buttons)&&p.buttons.length?p.buttons:[defaultButton()]).slice(0,4).map(b=>({label:String(b.label||"按鈕"),type:b.type==="uri"?"uri":"message",text:String(b.text||""),uri:String(b.uri||""),color:String(b.color||"")}))})) }; }
function pageHtml(page, index, collapsed=false) { const opts=(values,current)=>values.map(v=>`<option value="${v}" ${v===current?"selected":""}>${v}</option>`).join(""); return `<div class="templatePage${collapsed?" collapsed":""}" data-page-index="${index}"><div class="templatePageHead"><strong>第 ${index+1} 頁 <span class="template-muted">400 x 600（LINE 2:3）</span></strong><button type="button" class="dangerButton" data-template-action="remove-page" ${index===0?"disabled":""}>刪除頁面</button></div><div class="templateImageUpload"><div class="templateUploadRow"><label>上傳圖片<input data-field="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label><a href="${esc(page.imageUrl||"#")}" target="_blank" rel="noopener">查看圖片</a></div><input data-field="imageUrl" type="url" value="${esc(page.imageUrl)}" placeholder="上傳後自動產生圖片 URL，也可貼 HTTPS 圖片網址" /><div class="templateImageStatus">圖片依下方比例裁切預覽；建議尺寸 400 x 600，檔案 1MB 內。</div></div><div class="templateGrid"><label>點圖連結<input data-field="imageLink" type="url" value="${esc(page.imageLink)}" placeholder="點圖片後開啟的網址，可空白" /></label><label>卡片 Size<select data-field="bubbleSize">${opts(sizes,page.bubbleSize)}</select></label><label>圖片比例<input data-field="imageAspectRatio" type="text" value="${esc(validRatio(page.imageAspectRatio))}" /></label><label>圖片模式<select data-field="imageAspectMode">${opts(["cover","fit"],page.imageAspectMode)}</select></label></div><div class="templateButtons">${page.buttons.map((b,i)=>buttonHtml(b,i)).join("")}</div><div style="margin-top:10px"><button type="button" class="secondaryButton" data-template-action="add-button">新增 button</button></div></div>`; }
function buttonHtml(button,index) { const color=/^#[0-9a-f]{6}$/i.test(button.color)?button.color:"#06C755"; return `<div class="templateButton" data-button-index="${index}"><div class="templateButtonGrid"><label>按鈕文字<input data-field="label" value="${esc(button.label)}" /></label><label>動作<select data-field="type"><option value="message" ${button.type!=="uri"?"selected":""}>送出文字</option><option value="uri" ${button.type==="uri"?"selected":""}>開啟連結</option></select></label><label>送出文字<input data-field="text" value="${esc(button.text)}" placeholder="會員打卡" /></label><label>連結 URL<input data-field="uri" type="url" value="${esc(button.uri)}" placeholder="https://..." /></label><label>顏色<div class="templateColorRow"><input data-field="colorPicker" type="color" value="${color}" /><input data-field="color" value="${esc(button.color)}" placeholder="#06C755" /></div></label><button type="button" class="dangerButton" data-template-action="remove-button" ${index===0?"disabled":""}>刪除</button></div></div>`; }
function collapsedTemplatePages(){return [...document.querySelectorAll("#templatePages .templatePage.collapsed")].map(page=>Number(page.dataset.pageIndex))}
function renderCheckinTemplate(template, collapsedPages=[]) { const t=normalizeTemplate(template); checkinTemplateDraft=t; $("#templateActive").checked=t.active; $("#templateEntryUrl").value=dailyEntryUrl(); $("#templateAltText").value=t.altText; $("#templateRotationMode").value=t.rotationMode; $("#templatePages").innerHTML=t.pages.map((page,index)=>pageHtml(page,index,collapsedPages.includes(index))).join(""); renderTemplatePageToggles(); refreshTemplatePreview(); }
function collectTemplate() { const pages=[...document.querySelectorAll("#templatePages .templatePage")].map(page=>{const v=k=>String(page.querySelector(`[data-field="${k}"]`)?.value||"").trim();return {imageUrl:v("imageUrl"),imageLink:v("imageLink"),bubbleSize:validSize(v("bubbleSize")),imageAspectRatio:validRatio(v("imageAspectRatio")),imageAspectMode:validMode(v("imageAspectMode")),buttons:[...page.querySelectorAll(".templateButton")].map(button=>{const b=k=>String(button.querySelector(`[data-field="${k}"]`)?.value||"").trim();return {label:b("label")||"按鈕",type:b("type")==="uri"?"uri":"message",text:b("text"),uri:b("uri"),color:b("color")}}).filter(b=>b.label&&(b.type==="uri"?b.uri:b.text))};});return {active:$("#templateActive").checked,entryUrl:$("#templateEntryUrl").value.trim(),altText:$("#templateAltText").value.trim()||"簽到贈點活動",rotationMode:validRotation($("#templateRotationMode").value),pages}; }
function flexPreview(t) { return {type:"flex",altText:t.altText,contents:{type:"carousel",contents:t.pages.map(p=>({type:"bubble",size:p.bubbleSize,body:{type:"box",layout:"vertical",contents:[{type:"image",url:p.imageUrl,size:"full",aspectMode:p.imageAspectMode,aspectRatio:p.imageAspectRatio,gravity:"top",...(p.imageLink?{action:{type:"uri",uri:p.imageLink}}:{})}],paddingAll:"0px"},...(p.buttons.length?{footer:{type:"box",layout:"vertical",contents:p.buttons.map(b=>({type:"button",style:"primary",color:b.color||"#06C755",action:b.type==="uri"?{type:"uri",label:b.label,uri:b.uri}:{type:"message",label:b.label,text:b.text}}))}}:{})}))}}; }
function refreshTemplatePreview(){ const t=collectTemplate(); const view=t.pages.length?t:checkinTemplateDraft||defaultTemplate(); $("#templatePreview").textContent=JSON.stringify(flexPreview(view).contents,null,2); $("#templateVisualPreview").innerHTML=view.pages.map((p,i)=>`<div class="templatePhone"><div class="templatePhoneImage">${p.imageUrl?`<img src="${esc(p.imageUrl)}" alt="第 ${i+1} 頁圖片">`:`<span>上傳第 ${i+1} 頁圖片</span>`}</div><div class="templatePhoneFooter">${p.buttons.map(b=>`<div class="templatePhoneButton" style="background:${esc(/^#[0-9a-f]{6}$/i.test(b.color)?b.color:"#06C755")}">${esc(b.label)}</div>`).join("")||'<span class="template-muted">尚未設定按鈕</span>'}</div></div>`).join(""); }
function templateStatus(message, ok){const a=$("#templateStatus"),b=$("#templateInlineStatus");for(const x of [a,b]){x.textContent=message||"";x.className=`${x===a?"templateStatus":"templateInlineStatus"} ${ok?"ok":"bad"}`}}
async function loadCheckinTemplate(){try{const data=await api("/v1/admin/checkin-template");renderCheckinTemplate(data.template||defaultTemplate())}catch(error){templateStatus(error.message,false)}}
async function saveCheckinTemplate(){const t=collectTemplate(),collapsed=collapsedTemplatePages();if(!t.entryUrl||!t.pages.length||t.pages.some(p=>!p.imageUrl))return templateStatus("請填寫活動入口網址，並為每一頁上傳圖片或貼上 HTTPS 圖片網址。",false);const button=$("#templateSave");button.disabled=true;button.textContent="儲存中...";try{const data=await api("/v1/admin/checkin-template",t);renderCheckinTemplate(data.template||t,collapsed);templateStatus("已儲存模板，已建立新的觀看內容。",true)}catch(error){templateStatus(error.message,false)}finally{button.disabled=false;button.textContent="儲存模板"}}
async function optimizeTemplateImage(file){const target=900*1024;if(file.size<=target)return file;if(!globalThis.createImageBitmap)throw new Error("此瀏覽器無法自動壓縮圖片");const source=await createImageBitmap(file);try{let scale=Math.min(1,1200/Math.max(source.width,source.height)),best=null;for(let pass=0;pass<4;pass+=1){const width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale)),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;canvas.getContext("2d").drawImage(source,0,0,width,height);for(const quality of [.86,.76,.66,.56]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));if(!blob)continue;best=blob;if(blob.size<=target)return new File([blob],`${file.name.replace(/\.[^.]+$/,"")||"carousel"}.webp`,{type:"image/webp"})}scale*=.72}if(!best||best.size>1024*1024)throw new Error("圖片壓縮後仍超過 1MB，請使用較小圖片");return new File([best],`${file.name.replace(/\.[^.]+$/,"")||"carousel"}.webp`,{type:"image/webp"})}finally{source.close?.()}}
async function uploadTemplateImage(input){const original=input.files?.[0],page=input.closest(".templatePage"),field=page?.querySelector('[data-field="imageUrl"]'),status=page?.querySelector(".templateImageStatus");if(!original||!field)return;try{status.textContent=original.size>900*1024?"圖片壓縮中...":"圖片上傳中...";const file=await optimizeTemplateImage(original);field.value=URL.createObjectURL(file);refreshTemplatePreview();const form=new FormData();form.append("image",file,file.name);status.textContent=`上傳中（${Math.round(original.size/1024)} KB → ${Math.round(file.size/1024)} KB）...`;const res=await fetch("/v1/admin/checkin-template/upload-image",{method:"POST",headers:{authorization:`Bearer ${token}`},body:form});const json=await res.json();if(!res.ok)throw new Error(json.error||"圖片上傳失敗");field.value=json.url;status.textContent=`已上傳：${Math.round(original.size/1024)} KB → ${Math.round(json.size/1024)} KB`;refreshTemplatePreview()}catch(error){status.textContent=`上傳失敗：${error.message||"請改用 JPG、PNG 或 WebP 圖片"}`}}
function renderTemplatePageToggles(){document.querySelectorAll(".templatePageHead").forEach(head=>{if(head.querySelector("[data-template-toggle]"))return;const toggle=document.createElement("button");toggle.type="button";toggle.className="secondaryButton template-toggle";toggle.dataset.templateToggle="1";toggle.textContent=head.closest(".templatePage")?.classList.contains("collapsed")?"展開設定":"收合設定";head.insertBefore(toggle,head.querySelector(".dangerButton"));toggle.onclick=()=>{const page=head.closest(".templatePage"),collapsed=page.classList.toggle("collapsed");toggle.textContent=collapsed?"展開設定":"收合設定"}})}
$("#templateAddPage").addEventListener("click",()=>{const t=collectTemplate(),collapsed=collapsedTemplatePages();t.pages.push(defaultPage());renderCheckinTemplate(t,collapsed);templateStatus(`已新增第 ${t.pages.length} 頁，請上傳圖片。`,true)});$("#templateSave").addEventListener("click",saveCheckinTemplate);$("#templatePages").addEventListener("input",refreshTemplatePreview);$("#templatePages").addEventListener("change",async e=>{if(e.target.matches('[data-field="colorPicker"]'))e.target.closest(".templateColorRow").querySelector('[data-field="color"]').value=e.target.value.toUpperCase();if(e.target.matches('[data-field="imageFile"]'))await uploadTemplateImage(e.target);refreshTemplatePreview()});$("#templatePages").addEventListener("click",e=>{const button=e.target.closest("[data-template-action]");if(!button)return;const t=collectTemplate(),page=button.closest(".templatePage"),i=Number(page?.dataset.pageIndex),collapsed=collapsedTemplatePages();if(button.dataset.templateAction==="add-button")t.pages[i].buttons.push(defaultButton());if(button.dataset.templateAction==="remove-page"&&i>0){t.pages.splice(i,1);renderCheckinTemplate(t,collapsed.filter(x=>x!==i).map(x=>x>i?x-1:x));return}if(button.dataset.templateAction==="remove-button"){const j=Number(button.closest(".templateButton")?.dataset.buttonIndex);if(j>0)t.pages[i].buttons.splice(j,1)}renderCheckinTemplate(t,collapsed)});["#templateEntryUrl","#templateAltText","#templateRotationMode","#templateActive"].forEach(id=>$(id).addEventListener("input",refreshTemplatePreview));
$("#copyTemplateEntry").addEventListener("click", async () => { await navigator.clipboard.writeText(dailyEntryUrl()); templateStatus("活動入口網址已複製。", true); });
