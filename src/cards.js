import { newId } from './member-repository.js';

const CARD_COLUMNS = `
  id, platform_user_id, display_name, english_name, company_name, job_title, department,
  mobile, company_phone, email, website_url, line_url, address, service_description,
  cover_url, buttons_json, selected_version, versions_json, status, created_at, updated_at
`;
const DEFAULT_CARD_COVER_URL = '/card-default-cover.jpg';
const FIXED_STORE_ADDRESS = '台中市烏日區高鐵一路268號7樓之11';
const FIXED_STORE_MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(FIXED_STORE_ADDRESS)}`;
const DEFAULT_SERVICE_DESCRIPTION = `源自對美的熱愛創立了米拉
專注研發天然安全保養彩妝
嚴格品質把關貼近肌膚需求
美麗是自信與生活態度展現
讓每次保養化為寵愛的儀式`;

const text = (value, length) => String(value || '').trim().slice(0, length);
const normaliseTextAlign = (value) => ['left', 'center', 'right'].includes(String(value || '')) ? String(value) : 'left';

function normaliseUrl(value, label, { allowEmpty = true } = {}) {
  const url = text(value, 2048);
  if (!url && allowEmpty) return '';
  if (!/^https?:\/\//i.test(url)) throw new Error(`${label}必須以 http:// 或 https:// 開頭`);
  try { new URL(url); } catch { throw new Error(`${label}格式不正確`); }
  return url;
}

function normaliseButtons(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((item, index) => {
    const label = text(item?.label, 24);
    const type = ['url', 'phone', 'email', 'line', 'map'].includes(item?.type) ? item.type : 'url';
    let target = text(item?.value, 2048);
    if (!label || !target) return null;
    if (type === 'phone') {
      const phone = target.replace(/^tel:/i, '').replace(/[\s()-]/g, '');
      if (!/^[+0-9]{6,24}$/.test(phone)) throw new Error(`第 ${index + 1} 個按鈕的電話格式不正確`);
      target = `tel:${phone}`;
    } else if (type === 'email') {
      target = target.replace(/^mailto:/i, '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new Error(`第 ${index + 1} 個按鈕的 Email 格式不正確`);
      target = `mailto:${target}`;
    } else if (type === 'map') {
      target = /^https?:\/\//i.test(target) ? normaliseUrl(target, `第 ${index + 1} 個按鈕的地圖網址`, { allowEmpty: false }) : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
    } else {
      target = normaliseUrl(target, `第 ${index + 1} 個按鈕的網址`, { allowEmpty: false });
    }
    return { label, type, value: target, color: /^#[0-9a-f]{6}$/i.test(String(item?.color || '')) ? String(item.color) : '', order: index + 1, enabled: item?.enabled !== false };
  }).filter(Boolean);
}

// 新名片的三個基本入口。資料未填時仍保留按鈕，統一導向 Google，
// 讓使用者先能看到完整名片結構，之後在「編輯內容」補上資料即可。
function defaultCardButtons(card = {}) {
  const phone = text(card.mobile || card.companyPhone, 40).replace(/[\s()-]/g, '');
  const lineUrl = text(card.lineUrl, 2048);
  const googleUrl = 'https://www.google.com/';
  return normaliseButtons([
    { label: '撥打電話', type: phone ? 'phone' : 'url', value: phone ? `tel:${phone}` : googleUrl, color: '#B96072' },
    { label: '加入 LINE 好友', type: lineUrl ? 'line' : 'url', value: lineUrl || googleUrl, color: '#B96072' },
    { label: '店家地址', type: 'map', value: FIXED_STORE_MAP_URL, color: '#8D6A54' },
  ]);
}

function enforceFixedCardActions(buttons, defaults) {
  const result = [...buttons];
  while (result.length < 2) result.push(defaults[result.length]);
  result[2] = {
    label: '店家地址',
    type: 'map',
    value: FIXED_STORE_MAP_URL,
    color: '#8D6A54',
    order: 3,
    enabled: true,
  };
  return result.slice(0, 4).map((button, index) => ({ ...button, order: index + 1 }));
}

const CARD_VERSIONS = ['standard', 'full', 'square'];
const VERSION_LAYOUT = { standard: 'landscape', full: 'portrait', square: 'square' };

// 舊名片可能只留下電話一個按鈕；在使用者首次儲存新版設定前補齊三個預設入口。
// buttonDefaultsSeeded=true 之後，使用者自行刪除的按鈕不會被自動加回。
function seedDefaultButtons(buttons, defaults, seeded) {
  if (seeded) return buttons;
  const result = [...buttons];
  for (const fallback of defaults) {
    if (result.some((item) => item.type === fallback.type || item.label === fallback.label)) continue;
    result.push(fallback);
  }
  return result.slice(0, 4);
}
function parseVersions(row) {
  let input = {};
  try { input = JSON.parse(row.versions_json || '{}'); } catch { input = {}; }
  let legacyButtons = [];
  try { legacyButtons = JSON.parse(row.buttons_json || '[]'); } catch { legacyButtons = []; }
  const result = {};
  const defaults = defaultCardButtons({
    mobile: row.mobile,
    companyPhone: row.company_phone,
    lineUrl: row.line_url,
    address: row.address,
    websiteUrl: row.website_url,
  });
  CARD_VERSIONS.forEach((version) => {
    const source = input?.[version] || {};
    const storedButtons = normaliseButtons(source.buttons || (version === 'standard' ? legacyButtons : []));
    const buttonDefaultsSeeded = source.buttonDefaultsSeeded === true;
    const buttons = enforceFixedCardActions(seedDefaultButtons(storedButtons, defaults, buttonDefaultsSeeded), defaults);
    result[version] = {
      coverUrl: text(source.coverUrl || (version === 'standard' ? row.cover_url : ''), 2048) || DEFAULT_CARD_COVER_URL,
      title: text(source.title, 120),
      description: text(source.description, 1600),
      serviceTextAlign: normaliseTextAlign(source.serviceTextAlign),
      descriptionTextAlign: normaliseTextAlign(source.descriptionTextAlign),
      buttons,
      buttonDefaultsSeeded,
      layout: VERSION_LAYOUT[version],
    };
  });
  return result;
}

function normaliseVersions(value, row = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const patched = { ...row, versions_json: JSON.stringify(source) };
  return parseVersions(patched);
}

function cardFromRow(row, publicView = false) {
  if (!row) return null;
  const versions = parseVersions(row);
  const selectedVersion = CARD_VERSIONS.includes(row.selected_version) ? row.selected_version : 'standard';
  const selected = versions[selectedVersion] || versions.standard;
  const card = {
    id: row.id,
    displayName: row.display_name,
    englishName: row.english_name,
    companyName: row.company_name,
    jobTitle: row.job_title,
    department: row.department,
    mobile: row.mobile,
    companyPhone: row.company_phone,
    email: row.email,
    websiteUrl: row.website_url,
    lineUrl: row.line_url,
    address: row.address,
    serviceDescription: row.service_description || DEFAULT_SERVICE_DESCRIPTION,
    serviceTextAlign: normaliseTextAlign(selected.serviceTextAlign),
    descriptionTextAlign: normaliseTextAlign(selected.descriptionTextAlign),
    coverUrl: selected.coverUrl,
    buttons: selected.buttons.filter((button) => button?.enabled !== false),
    selectedVersion,
    versions,
    status: row.status,
    updatedAt: row.updated_at,
  };
  return publicView ? card : { ...card, userId: row.platform_user_id, createdAt: row.created_at };
}

export async function getMyCard(db, userId) {
  const row = await db.prepare(`SELECT ${CARD_COLUMNS} FROM personal_cards WHERE platform_user_id = ? AND status != 'archived'`).bind(userId).first();
  return cardFromRow(row);
}

export async function saveMyCard(db, userId, payload, member) {
  const existing = await getMyCard(db, userId);
  const displayName = text(payload.displayName || existing?.displayName || member?.displayName, 120);
  if (!displayName) throw new Error('姓名為必填');
  const values = {
    displayName,
    englishName: text(payload.englishName, 120),
    companyName: text(payload.companyName, 180),
    jobTitle: text(payload.jobTitle, 120),
    department: text(payload.department, 120),
    mobile: text(payload.mobile || existing?.mobile || member?.phone, 40),
    companyPhone: text(payload.companyPhone, 40),
    email: text(payload.email || existing?.email || member?.email, 320),
    websiteUrl: normaliseUrl(payload.websiteUrl, '公司網站'),
    lineUrl: normaliseUrl(payload.lineUrl, 'LINE 連結'),
    address: text(payload.address, 300),
    serviceDescription: text(payload.serviceDescription || existing?.serviceDescription || DEFAULT_SERVICE_DESCRIPTION, 1600),
    serviceTextAlign: normaliseTextAlign(payload.serviceTextAlign || existing?.serviceTextAlign),
    selectedVersion: CARD_VERSIONS.includes(payload.selectedVersion) ? payload.selectedVersion : (existing?.selectedVersion || 'standard'),
    versions: normaliseVersions(payload.versions, existing ? { versions_json: JSON.stringify(existing.versions || {}), cover_url: existing.coverUrl, buttons_json: JSON.stringify(existing.buttons || []) } : {}),
    status: ['draft', 'published'].includes(payload.status) ? payload.status : 'published',
  };
  const defaults = defaultCardButtons(values);
  CARD_VERSIONS.forEach((version) => {
    if (!values.versions[version].buttons.length) values.versions[version].buttons = defaults;
    // 服務項目是共用內容；三種名片版型必須維持同一個文字對齊設定。
    values.versions[version].serviceTextAlign = values.serviceTextAlign;
  });
  const id = existing?.id || newId('card');
  const selected = values.versions[values.selectedVersion] || values.versions.standard;
  await db.prepare(`
    INSERT INTO personal_cards (
      id, platform_user_id, display_name, english_name, company_name, job_title, department,
      mobile, company_phone, email, website_url, line_url, address, service_description,
      cover_url, buttons_json, selected_version, versions_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform_user_id) DO UPDATE SET
      display_name = excluded.display_name, english_name = excluded.english_name,
      company_name = excluded.company_name, job_title = excluded.job_title, department = excluded.department,
      mobile = excluded.mobile, company_phone = excluded.company_phone, email = excluded.email,
      website_url = excluded.website_url, line_url = excluded.line_url, address = excluded.address,
      service_description = excluded.service_description, cover_url = excluded.cover_url,
      buttons_json = excluded.buttons_json, selected_version = excluded.selected_version,
      versions_json = excluded.versions_json, status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).bind(id, userId, values.displayName, values.englishName, values.companyName, values.jobTitle, values.department,
    values.mobile, values.companyPhone, values.email, values.websiteUrl, values.lineUrl, values.address,
    values.serviceDescription, selected.coverUrl, JSON.stringify(selected.buttons), values.selectedVersion,
    JSON.stringify(values.versions), values.status).run();
  return getMyCard(db, userId);
}

export async function getPublicCard(db, id) {
  const row = await db.prepare(`SELECT ${CARD_COLUMNS} FROM personal_cards WHERE id = ? AND status = 'published'`).bind(id).first();
  return cardFromRow(row, true);
}
