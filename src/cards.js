import { newId } from './member-repository.js';

const CARD_COLUMNS = `
  id, platform_user_id, display_name, english_name, company_name, job_title, department,
  mobile, company_phone, email, website_url, line_url, address, service_description,
  cover_url, buttons_json, status, created_at, updated_at
`;

const text = (value, length) => String(value || '').trim().slice(0, length);

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
      const phone = target.replace(/[\s()-]/g, '');
      if (!/^[+0-9]{6,24}$/.test(phone)) throw new Error(`第 ${index + 1} 個按鈕的電話格式不正確`);
      target = `tel:${phone}`;
    } else if (type === 'email') {
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

function cardFromRow(row, publicView = false) {
  if (!row) return null;
  let buttons = [];
  try { buttons = JSON.parse(row.buttons_json || '[]'); } catch { buttons = []; }
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
    serviceDescription: row.service_description,
    coverUrl: row.cover_url,
    buttons: Array.isArray(buttons) ? buttons.filter((button) => button?.enabled !== false) : [],
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
    serviceDescription: text(payload.serviceDescription, 1600),
    coverUrl: normaliseUrl(payload.coverUrl, '名片封面圖片'),
    buttons: normaliseButtons(payload.buttons),
    status: ['draft', 'published'].includes(payload.status) ? payload.status : 'published',
  };
  const id = existing?.id || newId('card');
  await db.prepare(`
    INSERT INTO personal_cards (
      id, platform_user_id, display_name, english_name, company_name, job_title, department,
      mobile, company_phone, email, website_url, line_url, address, service_description,
      cover_url, buttons_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform_user_id) DO UPDATE SET
      display_name = excluded.display_name, english_name = excluded.english_name,
      company_name = excluded.company_name, job_title = excluded.job_title, department = excluded.department,
      mobile = excluded.mobile, company_phone = excluded.company_phone, email = excluded.email,
      website_url = excluded.website_url, line_url = excluded.line_url, address = excluded.address,
      service_description = excluded.service_description, cover_url = excluded.cover_url,
      buttons_json = excluded.buttons_json, status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).bind(id, userId, values.displayName, values.englishName, values.companyName, values.jobTitle, values.department,
    values.mobile, values.companyPhone, values.email, values.websiteUrl, values.lineUrl, values.address,
    values.serviceDescription, values.coverUrl, JSON.stringify(values.buttons), values.status).run();
  return getMyCard(db, userId);
}

export async function getPublicCard(db, id) {
  const row = await db.prepare(`SELECT ${CARD_COLUMNS} FROM personal_cards WHERE id = ? AND status = 'published'`).bind(id).first();
  return cardFromRow(row, true);
}
