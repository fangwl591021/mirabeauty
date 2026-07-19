import { newId } from './member-repository.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function tokenKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`mirabeauty:line-token:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptToken(token, secret) {
  if (!secret) throw new Error('SESSION_SIGNING_SECRET is required');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(secret), encoder.encode(token));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptToken(row, secret) {
  if (!row?.token_ciphertext || !row?.token_iv || !secret) return '';
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(row.token_iv) }, await tokenKey(secret), base64ToBytes(row.token_ciphertext));
  return decoder.decode(decrypted);
}

async function lineRequest(path, token, init = {}) {
  return fetch(`https://api.line.me${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
}

async function validateToken(token) {
  const response = await lineRequest('/v2/bot/info', token);
  const text = await response.text();
  if (!response.ok) throw new Error(`LINE Token 驗證失敗：${text || response.status}`);
  let bot = {};
  try { bot = JSON.parse(text); } catch { bot = {}; }
  return { displayName: bot.displayName || '', basicId: bot.basicId || '', pictureUrl: bot.pictureUrl || '' };
}

export async function getLineTokenStatus(db) {
  const row = await db.prepare("SELECT token_last4, updated_at FROM line_channel_settings WHERE id = 'primary'").first();
  return { configured: Boolean(row?.token_last4), masked: row?.token_last4 ? `••••${row.token_last4}` : '', updatedAt: row?.updated_at || '' };
}

export async function saveLineToken(db, secret, actorUserId, rawToken) {
  const token = String(rawToken || '').trim();
  if (token.length < 40 || token.length > 4096) throw new Error('請輸入有效的 LINE Channel Access Token');
  const bot = await validateToken(token);
  const encrypted = await encryptToken(token, secret);
  await db.prepare(`INSERT INTO line_channel_settings
    (id, token_ciphertext, token_iv, token_last4, updated_by_user_id)
    VALUES ('primary', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET token_ciphertext = excluded.token_ciphertext,
      token_iv = excluded.token_iv, token_last4 = excluded.token_last4,
      updated_by_user_id = excluded.updated_by_user_id, updated_at = CURRENT_TIMESTAMP`)
    .bind(encrypted.ciphertext, encrypted.iv, token.slice(-4), actorUserId).run();
  return { configured: true, masked: `••••${token.slice(-4)}`, bot };
}

export async function testSavedLineToken(db, secret) {
  const row = await db.prepare("SELECT token_ciphertext, token_iv FROM line_channel_settings WHERE id = 'primary'").first();
  const token = await decryptToken(row, secret);
  if (!token) throw new Error('尚未設定 LINE Channel Access Token');
  return validateToken(token);
}

function parseDataUrlImage(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const binary = atob(match[2].replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return { contentType: match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase(), bytes };
}

function aliasId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

function normalizedConfig(input, meta = {}) {
  const config = input && typeof input === 'object' ? JSON.parse(JSON.stringify(input)) : {};
  const width = Number(config.size?.width);
  const height = Number(config.size?.height);
  if (width !== 2500 || ![843, 1686].includes(height)) throw new Error('圖文選單尺寸必須為 2500×843 或 2500×1686');
  config.size = { width, height };
  config.selected = config.selected !== false;
  config.name = String(config.name || meta.name || 'MiraBeauty 圖文選單').trim().slice(0, 300);
  config.chatBarText = String(config.chatBarText || meta.chatBarText || '選單').trim().slice(0, 14);
  if (!config.name || !config.chatBarText) throw new Error('選單名稱與 ChatBar 文字為必填');
  if (!Array.isArray(config.areas) || !config.areas.length || config.areas.length > 20) throw new Error('請設定 1 至 20 個點擊區域');
  config.areas = config.areas.map((area, index) => {
    const bounds = area?.bounds || {};
    const cleanBounds = { x: Math.round(Number(bounds.x)), y: Math.round(Number(bounds.y)), width: Math.round(Number(bounds.width)), height: Math.round(Number(bounds.height)) };
    if (Object.values(cleanBounds).some(value => !Number.isFinite(value)) || cleanBounds.x < 0 || cleanBounds.y < 0 || cleanBounds.width <= 0 || cleanBounds.height <= 0 || cleanBounds.x + cleanBounds.width > width || cleanBounds.y + cleanBounds.height > height) throw new Error(`區域 #${index + 1} 超出圖片範圍`);
    const action = area?.action || {};
    if (!['uri', 'message', 'postback', 'richmenuswitch'].includes(action.type)) throw new Error(`區域 #${index + 1} 動作類型無效`);
    const cleanAction = { type: action.type };
    if (action.type === 'uri') { cleanAction.uri = String(action.uri || '').trim(); if (!/^https?:\/\//i.test(cleanAction.uri)) throw new Error(`區域 #${index + 1} 網址無效`); }
    if (action.type === 'message') { cleanAction.text = String(action.text || '').trim().slice(0, 300); if (!cleanAction.text) throw new Error(`區域 #${index + 1} 缺少傳送文字`); }
    if (action.type === 'postback') { cleanAction.data = String(action.data || '').trim().slice(0, 300); cleanAction.displayText = String(action.displayText || action.text || '').trim().slice(0, 300); if (!cleanAction.data) throw new Error(`區域 #${index + 1} 缺少 Postback Data`); if (!cleanAction.displayText) delete cleanAction.displayText; }
    if (action.type === 'richmenuswitch') { cleanAction.richMenuAliasId = aliasId(action.richMenuAliasId); cleanAction.data = String(action.data || '').trim().slice(0, 300); if (!cleanAction.richMenuAliasId || !cleanAction.data) throw new Error(`區域 #${index + 1} 缺少切換選單 Alias 或 Data`); }
    return { bounds: cleanBounds, action: cleanAction };
  });
  return config;
}

async function richMenuRows(db) {
  const rows = await db.prepare(`SELECT id, name, alias_id, chat_bar_text, config_json, image_data_url,
    line_rich_menu_id, status, updated_at, created_at FROM rich_menus ORDER BY updated_at DESC LIMIT 100`).all();
  return (rows.results || []).map(row => ({
    id: row.id, name: row.name, aliasId: row.alias_id, date: row.updated_at || row.created_at,
    updatedAt: row.updated_at || '', data: JSON.parse(row.config_json || '{}'), image: row.image_data_url || '',
    lineRichMenuId: row.line_rich_menu_id || '', status: row.status || 'draft',
  }));
}

async function saveRichMenu(db, actorUserId, payload) {
  const id = String(payload.id || newId('richmenu')).trim().slice(0, 120);
  const name = String(payload.name || payload.data?.name || 'New Rich Menu').trim().slice(0, 300);
  const config = normalizedConfig(payload.data || payload.config || {}, { name, chatBarText: payload.data?.chatBarText || '選單' });
  const image = String(payload.image || payload.imageDataUrl || '').trim();
  if (!parseDataUrlImage(image) || image.length > 1500000) throw new Error('請使用 1MB 以下的 JPG 或 PNG 圖片');
  const normalizedAlias = aliasId(payload.aliasId || name || id);
  await db.prepare(`INSERT INTO rich_menus
    (id, name, alias_id, chat_bar_text, config_json, image_data_url, status, created_by_user_id, updated_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, alias_id = excluded.alias_id,
      chat_bar_text = excluded.chat_bar_text, config_json = excluded.config_json,
      image_data_url = excluded.image_data_url,
      status = CASE WHEN rich_menus.status = 'deployed' THEN 'updated' ELSE rich_menus.status END,
      updated_by_user_id = excluded.updated_by_user_id, updated_at = CURRENT_TIMESTAMP`)
    .bind(id, name, normalizedAlias, config.chatBarText, JSON.stringify(config), image, actorUserId, actorUserId).run();
  const saves = await richMenuRows(db);
  return { success: true, item: saves.find(item => item.id === id), saves };
}

async function upsertAlias(token, value, richMenuId) {
  const normalized = aliasId(value);
  if (!normalized) return '';
  const create = await lineRequest('/v2/bot/richmenu/alias', token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ richMenuAliasId: normalized, richMenuId }) });
  if (create.ok) return normalized;
  const update = await lineRequest(`/v2/bot/richmenu/alias/${encodeURIComponent(normalized)}`, token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ richMenuId }) });
  if (!update.ok) throw new Error(`設定 Alias 失敗：${await update.text()}`);
  return normalized;
}

async function deployRichMenu(db, secret, actorUserId, payload) {
  const tokenRow = await db.prepare("SELECT token_ciphertext, token_iv FROM line_channel_settings WHERE id = 'primary'").first();
  const token = await decryptToken(tokenRow, secret);
  if (!token) throw new Error('請先輸入並儲存 LINE Channel Access Token');
  const config = normalizedConfig(payload.richMenuConfig || payload.menuObject || {}, { name: payload.name, chatBarText: payload.chatBarText });
  const image = parseDataUrlImage(String(payload.imageBase64 || payload.image || ''));
  if (!image || image.bytes.length > 1024 * 1024) throw new Error('部署圖片必須為 1MB 以下 JPG 或 PNG');
  const create = await lineRequest('/v2/bot/richmenu', token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) });
  const createText = await create.text();
  if (!create.ok) throw new Error(`建立 LINE 圖文選單失敗：${createText}`);
  const richMenuId = JSON.parse(createText).richMenuId;
  try {
    const upload = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': image.contentType }, body: image.bytes });
    if (!upload.ok) throw new Error(`上傳選單圖片失敗：${await upload.text()}`);
    const setDefault = await lineRequest(`/v2/bot/user/all/richmenu/${richMenuId}`, token, { method: 'POST' });
    if (!setDefault.ok) throw new Error(`設定預設選單失敗：${await setDefault.text()}`);
    const normalizedAlias = await upsertAlias(token, payload.aliasId || config.name, richMenuId);
    const id = String(payload.id || '').trim();
    if (id) await db.prepare("UPDATE rich_menus SET line_rich_menu_id = ?, alias_id = ?, status = 'deployed', deployed_at = CURRENT_TIMESTAMP, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(richMenuId, normalizedAlias, actorUserId, id).run();
    return { success: true, richMenuId, richMenuAliasId: normalizedAlias };
  } catch (error) {
    await lineRequest(`/v2/bot/richmenu/${richMenuId}`, token, { method: 'DELETE' }).catch(() => null);
    throw error;
  }
}

export async function handleRichMenuAction(db, secret, actorUserId, action, payload = {}) {
  if (action === 'ADMIN_GET_RICH_MENU_SAVES') return richMenuRows(db);
  if (action === 'ADMIN_SAVE_RICH_MENU') return saveRichMenu(db, actorUserId, payload);
  if (action === 'ADMIN_DELETE_RICH_MENU_SAVE') {
    const id = String(payload.id || '').trim();
    if (!id) throw new Error('缺少圖文選單 ID');
    await db.prepare('DELETE FROM rich_menus WHERE id = ?').bind(id).run();
    return { success: true, saves: await richMenuRows(db) };
  }
  if (action === 'UPLOAD_IMAGE') return { url: String(payload.imageBase64 || '') };
  if (action === 'DEPLOY_RICH_MENU') return deployRichMenu(db, secret, actorUserId, payload);
  throw new Error('不支援的圖文選單操作');
}
