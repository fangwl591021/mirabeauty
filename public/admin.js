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
$("#campaignForm").addEventListener("submit", (event) =>
  submitForm(event, "/v1/admin/ad-campaigns", () => ({
    name: $("#campaignName").value.trim(),
    startsAt: localIso($("#campaignStart").value),
    endsAt: localIso($("#campaignEnd").value),
    requiredCreativeCount: Number($("#campaignCount").value),
    rotationMode: $("#campaignRotation").value,
    status: $("#campaignStatus").value,
  })),
);
$("#creativeForm").addEventListener("submit", (event) =>
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
