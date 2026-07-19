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

async function encryptionKey(secret) {
  if (!secret) throw new Error('SESSION_SIGNING_SECRET 尚未設定');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`mirabeauty:openai-api-key:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptApiKey(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(value));
  return { ciphertext:bytesToBase64(new Uint8Array(ciphertext)), iv:bytesToBase64(iv) };
}

async function decryptApiKey(row, secret) {
  if (!row?.api_key_ciphertext || !row?.api_key_iv) return '';
  const plaintext = await crypto.subtle.decrypt({ name:'AES-GCM', iv:base64ToBytes(row.api_key_iv) }, await encryptionKey(secret), base64ToBytes(row.api_key_ciphertext));
  return decoder.decode(plaintext);
}

async function validateApiKey(apiKey) {
  const response = await fetch('https://api.openai.com/v1/models', { headers:{ authorization:`Bearer ${apiKey}` } });
  if (response.ok) return true;
  const body = await response.json().catch(()=>({}));
  const message = body?.error?.message || `HTTP ${response.status}`;
  throw new Error(`OpenAI API 金鑰驗證失敗：${message}`);
}

async function savedRow(db) {
  return db.prepare("SELECT api_key_ciphertext, api_key_iv, api_key_last4, updated_at FROM openai_api_settings WHERE id='primary'").first();
}

export async function getOpenAIKeyStatus(db, fallbackKey = '') {
  const row = await savedRow(db);
  if (row?.api_key_ciphertext) return { configured:true, source:'database', masked:`••••${row.api_key_last4}`, updatedAt:row.updated_at || '' };
  if (String(fallbackKey || '').trim()) return { configured:true, source:'environment', masked:'環境密鑰', updatedAt:'' };
  return { configured:false, source:'none', masked:'', updatedAt:'' };
}

export async function resolveOpenAIKey(db, secret, fallbackKey = '') {
  const row = await savedRow(db);
  if (row?.api_key_ciphertext) return decryptApiKey(row, secret);
  return String(fallbackKey || '').trim();
}

export async function saveOpenAIKey(db, secret, actorUserId, rawKey) {
  const apiKey = String(rawKey || '').trim();
  if (!apiKey.startsWith('sk-') || apiKey.length < 30 || apiKey.length > 512) throw new Error('請輸入有效的 OpenAI API Key');
  await validateApiKey(apiKey);
  const encrypted = await encryptApiKey(apiKey, secret);
  await db.prepare(`INSERT INTO openai_api_settings (id,api_key_ciphertext,api_key_iv,api_key_last4,updated_by_user_id)
    VALUES ('primary',?,?,?,?) ON CONFLICT(id) DO UPDATE SET api_key_ciphertext=excluded.api_key_ciphertext,
    api_key_iv=excluded.api_key_iv,api_key_last4=excluded.api_key_last4,updated_by_user_id=excluded.updated_by_user_id,
    updated_at=CURRENT_TIMESTAMP`).bind(encrypted.ciphertext,encrypted.iv,apiKey.slice(-4),actorUserId).run();
  return getOpenAIKeyStatus(db);
}

export async function testOpenAIKey(db, secret, fallbackKey = '') {
  const key = await resolveOpenAIKey(db, secret, fallbackKey);
  if (!key) throw new Error('尚未設定 OpenAI API Key');
  await validateApiKey(key);
  return getOpenAIKeyStatus(db, fallbackKey);
}

export async function deleteOpenAIKey(db) {
  await db.prepare("DELETE FROM openai_api_settings WHERE id='primary'").run();
}
