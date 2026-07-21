import { newId } from './member-repository.js';
import { sha256 } from './auth.js';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FIELD_LIMITS = { displayName:120, englishName:120, companyName:180, jobTitle:120, department:120, mobile:40, companyPhone:40, email:320, websiteUrl:2048, lineUrl:2048, address:300, serviceDescription:1600, note:1000 };
const text = (value, max = 1000) => String(value || '').trim().slice(0, max);
const CARD_VERSIONS = ['standard', 'full', 'square'];
const VERSION_LAYOUT = { standard:'landscape', full:'portrait', square:'square' };
const DEFAULT_CHAT_ALT_TEXT = '您收到一張數位名片';
const normaliseTextAlign = (value) => ['left', 'center', 'right'].includes(String(value || '')) ? String(value) : 'left';

function normaliseButtons(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((item, index) => {
    const label = text(item?.label, 24);
    const type = ['url','phone','email','line','map'].includes(item?.type) ? item.type : 'url';
    let target = text(item?.value, 2048);
    if (!label || !target) return null;
    if (type === 'phone') target = `tel:${target.replace(/^tel:/i, '').replace(/[\s()-]/g, '')}`;
    if (type === 'email') target = `mailto:${target.replace(/^mailto:/i, '')}`;
    if (type === 'map' && !/^https?:\/\//i.test(target)) target = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
    if (['url','line'].includes(type) && !/^https?:\/\//i.test(target)) return null;
    return { label, type, value:target, color:/^#[0-9a-f]{6}$/i.test(String(item?.color || '')) ? String(item.color) : '#B96072', order:index + 1, enabled:item?.enabled !== false };
  }).filter(Boolean);
}
function defaultButtons(row = {}) {
  const phone = text(row.mobile || row.company_phone, 40).replace(/[\s()-]/g, '');
  const line = text(row.line_url, 2048);
  const address = text(row.address, 300);
  return normaliseButtons([
    { label:'撥打電話', type:phone ? 'phone' : 'url', value:phone || 'https://www.google.com/', color:'#B96072' },
    { label:'加入 LINE 好友', type:line ? 'line' : 'url', value:line || 'https://www.google.com/', color:'#B96072' },
    { label:'店家地址', type:address ? 'map' : 'url', value:address || 'https://www.google.com/', color:'#8D6A54' },
  ]);
}
function parseVersions(row = {}) {
  let source = {}; try { source = JSON.parse(row.versions_json || '{}'); } catch {}
  const defaults = defaultButtons(row);
  return Object.fromEntries(CARD_VERSIONS.map((id) => {
    const value = source?.[id] || {};
    return [id, { coverUrl:text(value.coverUrl, 2048), title:text(value.title, 120), description:text(value.description, 1600), serviceTextAlign:normaliseTextAlign(value.serviceTextAlign), descriptionTextAlign:normaliseTextAlign(value.descriptionTextAlign), buttons:normaliseButtons(value.buttons).length ? normaliseButtons(value.buttons) : defaults, buttonDefaultsSeeded:value.buttonDefaultsSeeded === true, layout:VERSION_LAYOUT[id] }];
  }));
}
function normaliseVersions(value, row = {}) {
  const source = rawVersions(row);
  const normalized = parseVersions({ ...row, versions_json:JSON.stringify(value && typeof value === 'object' ? value : {}) });
  if (source._crmInsights) normalized._crmInsights = source._crmInsights;
  return normalized;
}
export const normalizePhone = (value) => text(value, 60).replace(/[^0-9+]/g, '').replace(/^\+8860?/, '0');
export const normalizeEmail = (value) => text(value, 320).toLowerCase();
export const normalizeNameCompany = (name, company) => `${text(name, 120)}|${text(company, 180)}`.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

function cleanCard(input = {}) {
  const card = {};
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) card[key] = text(input[key], limit);
  if (!card.displayName) throw new Error('請確認名片姓名');
  card.normalizedMobile = normalizePhone(card.mobile);
  card.normalizedEmail = normalizeEmail(card.email);
  card.normalizedNameCompany = normalizeNameCompany(card.displayName, card.companyName);
  return card;
}

function rawVersions(row = {}) {
  try { return JSON.parse(row.versions_json || '{}') || {}; } catch { return {}; }
}
function insightMeta(row = {}) {
  const value = rawVersions(row)._crmInsights || {};
  return {
    status:['queued','processing','ready','failed'].includes(value.status) ? value.status : '',
    cards:value.cards && typeof value.cards === 'object' ? value.cards : {},
    updatedAt:text(value.updatedAt, 80),
    error:text(value.error, 180),
    analysisVersion:text(value.analysisVersion, 40),
  };
}
function rowToCard(row) {
  if (!row) return null;
  const versions = parseVersions(row);
  const selectedVersion = CARD_VERSIONS.includes(row.selected_version) ? row.selected_version : 'standard';
  const selected = versions[selectedVersion];
  return { id:row.id, sourceType:row.source_type, sourcePersonalCardId:row.source_personal_card_id || '', displayName:row.display_name, englishName:row.english_name, companyName:row.company_name, jobTitle:row.job_title, department:row.department, mobile:row.mobile, companyPhone:row.company_phone, email:row.email, websiteUrl:row.website_url, lineUrl:row.line_url, address:row.address, serviceDescription:row.service_description, note:row.note, chatAltText:row.chat_alt_text || DEFAULT_CHAT_ALT_TEXT, selectedVersion, versions, coverUrl:selected.coverUrl, buttons:selected.buttons, hasImage:Boolean(row.front_r2_key), aiInsights:insightMeta(row), createdAt:row.created_at, updatedAt:row.updated_at };
}

async function findDuplicate(db, ownerId, card, excludedId = '') {
  const clauses = [];
  const bindings = [ownerId];
  if (card.normalizedMobile) { clauses.push('normalized_mobile = ?'); bindings.push(card.normalizedMobile); }
  if (card.normalizedEmail) { clauses.push('normalized_email = ?'); bindings.push(card.normalizedEmail); }
  if (card.normalizedNameCompany) { clauses.push('normalized_name_company = ?'); bindings.push(card.normalizedNameCompany); }
  if (!clauses.length) return null;
  let sql = `SELECT * FROM contact_cards WHERE scanner_user_id = ? AND status = 'active' AND (${clauses.join(' OR ')})`;
  if (excludedId) { sql += ' AND id != ?'; bindings.push(excludedId); }
  return db.prepare(`${sql} ORDER BY updated_at DESC LIMIT 1`).bind(...bindings).first();
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const OCR_SCHEMA = { type:'object', additionalProperties:false, required:['isBusinessCard','confidence','language',...Object.keys(FIELD_LIMITS)], properties:{ isBusinessCard:{type:'boolean'}, confidence:{type:'number'}, language:{type:'string'}, ...Object.fromEntries(Object.keys(FIELD_LIMITS).map((key)=>[key,{type:'string'}])) } };
const CONTENT_EXPANSION_SCHEMA = { type:'object', additionalProperties:false, required:['items'], properties:{ items:{ type:'array', minItems:3, maxItems:5, items:{ type:'string' } } } };
const CRM_INSIGHT_KEYS = ['personality','interests','wealth','health','career'];
const CRM_INSIGHT_ANALYSIS_VERSION = 'line-fate-v1';
const CRM_INSIGHT_SOURCE_KEYS = ['displayName','companyName','jobTitle','department','serviceDescription','note','address'];
const CRM_INSIGHTS_SCHEMA = { type:'object', additionalProperties:false, required:CRM_INSIGHT_KEYS, properties:Object.fromEntries(CRM_INSIGHT_KEYS.map((key)=>[key,{type:'string'}])) };

async function recognizeWithOpenAI(apiKey, model, images) {
  const content = [{ type:'input_text', text:'辨識這張商務名片。只擷取畫面中可確認的文字，不猜測；無法確認的欄位填空字串。若不是名片，isBusinessCard=false。繁體中文內容保留原文。note 僅放無法歸類但有價值的名片文字。' }];
  for (const image of images) content.push({ type:'input_image', image_url:`data:${image.type};base64,${bytesToBase64(image.bytes)}`, detail:'high' });
  const response = await fetch('https://api.openai.com/v1/responses', { method:'POST', headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json' }, body:JSON.stringify({ model:model || 'gpt-5.6-terra', reasoning:{effort:'low'}, max_output_tokens:1800, input:[{role:'user',content}], text:{format:{type:'json_schema',name:'business_card',strict:true,schema:OCR_SCHEMA}} }) });
  const result = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(result?.error?.message || 'AI 名片辨識暫時無法使用');
  const outputText = result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type === 'output_text')?.text;
  if (!outputText) throw new Error('AI 未回傳名片辨識結果');
  return JSON.parse(outputText);
}


// 使用 Responses 的 web_search 工具，只把 OCR／人工校正過的公開欄位送去查找。
// 回傳候選文案而非直接寫入，最後仍由使用者選取後才保存至數位名片。
export async function expandContactContent(db, userId, id, apiKey, model) {
  if (!apiKey) throw new Error('AI 擴寫尚未設定 API 金鑰');
  const row = await db.prepare("SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id, userId).first();
  if (!row) throw new Error('找不到收藏名片');
  const card = rowToCard(row);
  const facts = {
    name: card.displayName,
    company: card.companyName,
    title: card.jobTitle,
    department: card.department,
    website: card.websiteUrl,
    line: card.lineUrl,
    address: card.address,
    existingDescription: card.serviceDescription,
  };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json' },
    body:JSON.stringify({
      model:model || 'gpt-5.6-terra',
      reasoning:{ effort:'low' },
      tools:[{ type:'web_search' }],
      input:[{ role:'user', content:`你是繁體中文商務名片文案助手。請根據下列名片已確認欄位搜尋公開網路資料，再產出 3 至 5 條可放在數位名片「內容區」的候選文字。\n\n已確認資料：${JSON.stringify(facts)}\n\n規則：\n1. 每條 35 到 90 個繁體中文字，語氣專業、客觀、可直接顯示。\n2. 只能描述可由名片資料或搜尋結果合理支持的服務、定位或特色；不確定時保持保守，不捏造獎項、年資、價格、合作或保證。\n3. 不要寫電話、地址、網址、LINE ID、emoji、標題或條列符號。\n4. 不得包含醫療、投資、法律等結果保證。\n5. 只回傳 JSON。` }],
      text:{ format:{ type:'json_schema', name:'business_card_content_suggestions', strict:true, schema:CONTENT_EXPANSION_SCHEMA } },
    }),
  });
  const result = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(result?.error?.message || 'AI 擴寫暫時無法使用');
  const outputText = result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type === 'output_text')?.text;
  if (!outputText) throw new Error('AI 未回傳內容建議');
  const parsed = JSON.parse(outputText);
  const items = Array.isArray(parsed.items) ? parsed.items.map((item)=>text(item, 200)).filter(Boolean).slice(0,5) : [];
  if (items.length < 3) throw new Error('AI 未產生足夠的內容建議');
  return { items };
}


async function generateCrmInsights(apiKey, model, card) {
  const facts = { name:card.displayName, mobile:text(card.mobile || card.companyPhone,40).replace(/[^0-9+]/g,''), birthday:'', company:card.companyName, title:card.jobTitle };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json' },
    body:JSON.stringify({
      model:model || 'gpt-5.6-terra', reasoning:{effort:'low'}, max_output_tokens:900,
      input:[{ role:'user', content:`你是一位專業的商務 AI 心理與命理分析專家。請完全依照 LINE- 專案五大標籤規則分析這張掃描名片。\n\n姓名：${facts.name || '未知'}\n手機：${facts.mobile || '未知'}\n生日：${facts.birthday || '未知'}\n公司：${facts.company || '未知'}\n職稱：${facts.title || '未知'}\n\n分析規則：\n1. 姓名字形判斷行動／思考型，發音判斷外向／內斂，結構判斷主導／依附。\n2. 手機數字頻率依 1領導、2協調、3表達、4穩定、5自由、6責任、7分析、8成就、9理想分析；尾數判斷快攻／慢養，奇偶比判斷衝動／保守。\n3. 有生日時融合八字、紫微斗數、生命靈數與東西方星座；未提供生日就以現有欄位分析，不虛構命盤。\n4. 五項必須融合 VAK 感官偏好、分析／數據／直覺決策模式，以及積極／保守與風險偏好。\n5. personality、interests、wealth、health、career 每項以 20 至 40 個繁體中文字，同時描述具體特徵與商務應對建議。\n6. wealth 不宣稱實際收入或資產；health 不診斷疾病；不得捏造個資或經歷。只回傳 JSON。` }],
      text:{format:{type:'json_schema',name:'crm_five_insights',strict:true,schema:CRM_INSIGHTS_SCHEMA}},
    }),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result?.error?.message || 'AI 五大標籤暫時無法使用');
  const outputText=result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type==='output_text')?.text;
  if(!outputText)throw new Error('AI 未回傳五大標籤');
  const parsed=JSON.parse(outputText);
  return Object.fromEntries(CRM_INSIGHT_KEYS.map((key)=>[key,text(parsed[key],220)]));
}
function withInsightMeta(row, patch) {
  const source=rawVersions(row);
  source._crmInsights={...insightMeta(row),...patch,updatedAt:new Date().toISOString()};
  return JSON.stringify(source);
}
export async function submitImportInBackground(db, bucket, userId, eventId, apiKey, model) {
  if(!apiKey)throw new Error('名片 AI 辨識尚未設定 API 金鑰');
  const event=await db.prepare('SELECT * FROM card_import_events WHERE id=? AND scanner_user_id=?').bind(eventId,userId).first();
  if(!event)throw new Error('找不到這次名片掃描');
  if(event.contact_card_id) {
    const card=await db.prepare('SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=?').bind(event.contact_card_id,userId).first();
    return {card:rowToCard(card),existing:true};
  }
  const id=newId('contact');
  const placeholderVersions=JSON.stringify({_crmInsights:{status:'queued',cards:{},updatedAt:new Date().toISOString(),error:''}});
  await db.prepare(`INSERT INTO contact_cards (id,scanner_user_id,source_event_id,display_name,front_r2_key,front_content_type,versions_json)
    VALUES (?,?,?,?,?,?,?)`).bind(id,userId,eventId,'名片 AI 分析中',event.front_r2_key,event.front_content_type,placeholderVersions).run();
  await db.prepare("UPDATE card_import_events SET status='received', contact_card_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id,eventId).run();
  const card=await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first();
  return {card:rowToCard(card),existing:false};
}
export async function processImportInBackground(db, bucket, userId, eventId, apiKey, model) {
  const event=await db.prepare('SELECT * FROM card_import_events WHERE id=? AND scanner_user_id=?').bind(eventId,userId).first();
  if(!event?.contact_card_id)return;
  const contact=await db.prepare('SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=?').bind(event.contact_card_id,userId).first();
  if(!contact)return;
  await db.batch([
    db.prepare("UPDATE card_import_events SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId),
    db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(withInsightMeta(contact,{status:'processing',error:''}),contact.id),
  ]);
  try {
    const images=[];
    for(const key of [event.front_r2_key,event.back_r2_key].filter(Boolean)) { const object=await bucket.get(key); if(object)images.push({type:object.httpMetadata?.contentType || event.front_content_type || 'image/webp',bytes:await object.arrayBuffer()}); }
    const result=await recognizeWithOpenAI(apiKey,model,images);
    if(!result.isBusinessCard)throw new Error('這張圖片看起來不是名片，請重新拍攝');
    const card=cleanCard(result);
    const values=[card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany];
    await db.batch([
      db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(...values,withInsightMeta(contact,{status:'queued',cards:{},error:''}),contact.id,userId),
      db.prepare("UPDATE card_import_events SET status='created',ocr_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(result),eventId),
    ]);
  } catch(error) {
    await db.batch([
      db.prepare("UPDATE card_import_events SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId),
      db.prepare("UPDATE contact_cards SET display_name=?,versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind('名片辨識未完成',withInsightMeta(contact,{status:'failed',error:error.message || 'OCR 辨識失敗'}),contact.id),
    ]);
    console.error('Background card OCR failed',error);
    return;
  }
  // OCR 已成功寫入後才執行五大標籤。標籤失敗只能改變 _crmInsights，
  // 不得回滾或覆蓋已辨識完成的名片聯絡資料。
  try {
    await processContactInsightsInBackground(db,userId,contact.id,apiKey,model);
  } catch(error) {
    console.error('Post-OCR CRM insight scheduling failed',error);
  }
}

export async function queueLegacyFailedImportRetries(db, limit = 3) {
  const cappedLimit=Math.max(1,Math.min(Number(limit) || 3,10));
  const result=await db.prepare(`SELECT cie.id event_id,cie.scanner_user_id
    FROM card_import_events cie
    JOIN contact_cards cc ON cc.id=cie.contact_card_id
    WHERE cie.status='failed' AND cie.front_r2_key!='' AND cc.status='active'
      AND cc.display_name='名片分析未完成'
    ORDER BY cie.updated_at ASC LIMIT ?`).bind(cappedLimit).all();
  return (result.results || []).map((row)=>({eventId:row.event_id,userId:row.scanner_user_id}));
}


export async function queueContactCrmInsights(db, userId, id, force = false) {
  const row=await db.prepare("SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first();
  if(!row || (!force && ['queued','processing'].includes(insightMeta(row).status)))return false;
  await db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=? AND status='active'").bind(withInsightMeta(row,{status:'queued',cards:{},error:''}),id,userId).run();
  return true;
}
export async function processContactInsightsInBackground(db, userId, id, apiKey, model) {
  const row=await db.prepare("SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first();
  if(!row)return;
  await db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(withInsightMeta(row,{status:'processing',error:''}),id).run();
  try {
    const card=rowToCard(row);
    const cards=await generateCrmInsights(apiKey,model,card);
    await db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(withInsightMeta(row,{status:'ready',cards,error:'',analysisVersion:CRM_INSIGHT_ANALYSIS_VERSION}),id).run();
  } catch(error) {
    await db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(withInsightMeta(row,{status:'failed',error:error.message || '分析失敗'}),id).run();
    console.error('Background CRM insight analysis failed',error);
  }
}


export async function queueSystemCrmInsightBackfill(db, limit = 6) {
  const cappedLimit=Math.max(1,Math.min(Number(limit) || 6,20));
  const result=await db.prepare(`SELECT * FROM contact_cards
    WHERE status='active' AND (
      COALESCE(json_extract(versions_json, '$._crmInsights.status'),'') NOT IN ('ready','queued','processing')
      OR (json_extract(versions_json, '$._crmInsights.status')='ready' AND COALESCE(json_extract(versions_json, '$._crmInsights.analysisVersion'),'')!=?)
      OR (json_extract(versions_json, '$._crmInsights.status')='queued' AND updated_at <= datetime('now','-10 minutes'))
      OR (json_extract(versions_json, '$._crmInsights.status')='processing' AND updated_at <= datetime('now','-30 minutes'))
    ) ORDER BY updated_at ASC LIMIT ?`).bind(CRM_INSIGHT_ANALYSIS_VERSION,cappedLimit).all();
  const candidates=result.results || [];
  if(!candidates.length)return {queued:0,tasks:[]};
  await db.batch(candidates.map((row)=>db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?").bind(withInsightMeta(row,{status:'queued',error:''}),row.id,row.scanner_user_id)));
  return {queued:candidates.length,tasks:candidates.map((row)=>({id:row.id,userId:row.scanner_user_id}))};
}

export async function createImport(db, bucket, userId, form) {
  const files = ['front','back'].map((key)=>form.get(key)).filter((file)=>file instanceof File && file.size);
  if (!files.length || files.length > 2) throw new Error('請選擇名片正面，最多可加一張背面');
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('名片圖片僅支援 JPEG、PNG 或 WebP');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('單張圖片須小於 2MB');
  }
  const count = await db.prepare("SELECT COUNT(*) count FROM card_import_events WHERE scanner_user_id = ? AND created_at >= datetime('now','-1 day')").bind(userId).first();
  if (Number(count?.count || 0) >= 20) throw new Error('今日名片辨識已達 20 次，請明日再試');
  const id = newId('card_import');
  const keys = files.map((_, index)=>`card-collections/${userId}/${id}/${index ? 'back' : 'front'}.webp`);
  await Promise.all(files.map(async(file,index)=>bucket.put(keys[index], await file.arrayBuffer(), { httpMetadata:{contentType:file.type} })));
  await db.prepare('INSERT INTO card_import_events (id, scanner_user_id, front_r2_key, back_r2_key, front_content_type) VALUES (?, ?, ?, ?, ?)').bind(id,userId,keys[0],keys[1] || '',files[0].type).run();
  return { id, imageCount:files.length };
}

export async function recognizeImport(db, bucket, userId, eventId, apiKey, model) {
  if (!apiKey) throw new Error('名片 AI 辨識尚未設定 API 金鑰');
  const event = await db.prepare('SELECT * FROM card_import_events WHERE id = ? AND scanner_user_id = ?').bind(eventId,userId).first();
  if (!event) throw new Error('找不到這次名片掃描');
  await db.prepare("UPDATE card_import_events SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId).run();
  try {
    const images = [];
    for (const key of [event.front_r2_key,event.back_r2_key].filter(Boolean)) { const object=await bucket.get(key); if(object) images.push({type:object.httpMetadata?.contentType || event.front_content_type || 'image/webp',bytes:await object.arrayBuffer()}); }
    const result = await recognizeWithOpenAI(apiKey, model, images);
    const status = result.isBusinessCard ? 'review_ready' : 'rejected';
    await db.prepare('UPDATE card_import_events SET status=?, ocr_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,JSON.stringify(result),eventId).run();
    if (!result.isBusinessCard) throw new Error('這張圖片看起來不是名片，請重新拍攝');
    return { eventId, card:cleanCard(result), confidence:Number(result.confidence || 0), language:text(result.language,40) };
  } catch (error) {
    await db.prepare("UPDATE card_import_events SET status=CASE WHEN status='rejected' THEN status ELSE 'failed' END, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId).run();
    // 辨識失敗不保留無用途的原始照片；使用者重新拍攝即可，避免 R2 累積孤兒檔案。
    await Promise.all([event.front_r2_key,event.back_r2_key].filter(Boolean).map((key)=>bucket.delete(key)));
    await db.prepare("UPDATE card_import_events SET front_r2_key='', back_r2_key='' WHERE id=?").bind(eventId).run();
    throw error;
  }
}

export async function confirmImport(db, bucket, userId, eventId, payload = {}) {
  const event = await db.prepare('SELECT * FROM card_import_events WHERE id = ? AND scanner_user_id = ?').bind(eventId,userId).first();
  if (!event || event.status !== 'review_ready') throw new Error('名片辨識結果已失效，請重新掃描');
  const card = cleanCard(payload.card || payload);
  const self = await db.prepare('SELECT pc.id FROM platform_users pu LEFT JOIN member_profiles mp ON mp.platform_user_id=pu.id LEFT JOIN personal_cards pc ON pc.platform_user_id=pu.id WHERE pu.id=? AND ((? != \'\' AND (REPLACE(COALESCE(mp.phone,\'\'),\' \',\'\')=? OR REPLACE(COALESCE(pc.mobile,\'\'),\' \',\'\')=?)) OR (? != \'\' AND LOWER(COALESCE(pc.email,\'\'))=?)) LIMIT 1').bind(userId,card.normalizedMobile,card.normalizedMobile,card.normalizedMobile,card.normalizedEmail,card.normalizedEmail).first();
  if (self?.id) {
    await Promise.all([event.front_r2_key,event.back_r2_key].filter(Boolean).map((key)=>bucket.delete(key)));
    await db.prepare("UPDATE card_import_events SET status='rejected',front_r2_key='',back_r2_key='',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId).run();
    const error=new Error('這是你自己的名片，請回「我的名片」編輯'); error.code='self_card'; throw error;
  }
  const duplicate = await findDuplicate(db,userId,card);
  if (duplicate && payload.duplicateAction !== 'update') { const error=new Error('收藏名單已有相同名片'); error.code='duplicate_contact'; error.duplicate=rowToCard(duplicate); throw error; }
  const id = duplicate?.id || newId('contact');
  const sourceKey = event.front_r2_key;
  const values=[card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany];
  const queuedVersions=withInsightMeta(duplicate || {},{status:'queued',cards:{},error:''});
  if (duplicate) await db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(...values,queuedVersions,id,userId).run();
  else await db.prepare('INSERT INTO contact_cards (id,scanner_user_id,source_event_id,display_name,english_name,company_name,job_title,department,mobile,company_phone,email,website_url,line_url,address,service_description,note,normalized_mobile,normalized_email,normalized_name_company,front_r2_key,front_content_type,versions_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,userId,eventId,...values,sourceKey,event.front_content_type,queuedVersions).run();
  if (event.back_r2_key) await bucket.delete(event.back_r2_key);
  if (duplicate && sourceKey) await bucket.delete(sourceKey);
  await db.prepare('UPDATE card_import_events SET status=?, contact_card_id=?, back_r2_key=\'\', updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(duplicate?'updated':'created',id,eventId).run();
  return { card:rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first()), updated:Boolean(duplicate) };
}

export async function listContacts(db,userId,search='') {
  const q=`%${text(search,100).replace(/[\\%_]/g,'\\$&')}%`;
  const result = search ? await db.prepare("SELECT * FROM contact_cards WHERE scanner_user_id=? AND status='active' AND (display_name LIKE ? ESCAPE '\\' OR company_name LIKE ? ESCAPE '\\' OR mobile LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 100").bind(userId,q,q,q,q).all() : await db.prepare("SELECT * FROM contact_cards WHERE scanner_user_id=? AND status='active' ORDER BY updated_at DESC LIMIT 100").bind(userId).all();
  return (result.results || []).map(rowToCard);
}

export async function updateContact(db,userId,id,payload) {
  const existing=await db.prepare("SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first(); if(!existing) throw new Error('找不到收藏名片');
  const card=cleanCard({...rowToCard(existing),...payload}); const duplicate=await findDuplicate(db,userId,card,id); if(duplicate) throw new Error('收藏名單已有相同名片');
  const selectedVersion = CARD_VERSIONS.includes(payload.selectedVersion) ? payload.selectedVersion : (existing.selected_version || 'standard');
  const versions = normaliseVersions(payload.versions, existing);
  const existingCard=rowToCard(existing);
  const insightInputChanged=CRM_INSIGHT_SOURCE_KEYS.some((key)=>text(existingCard[key],FIELD_LIMITS[key] || 1000) !== text(card[key],FIELD_LIMITS[key] || 1000));
  if(insightInputChanged)versions._crmInsights={status:'queued',cards:{},updatedAt:new Date().toISOString(),error:''};
  const chatAltText = text(payload.chatAltText || existing.chat_alt_text || DEFAULT_CHAT_ALT_TEXT, 300);
  await db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,selected_version=?,versions_json=?,chat_alt_text=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany,selectedVersion,JSON.stringify(versions),chatAltText,id,userId).run();
  return rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first());
}

export async function deleteContact(db,bucket,userId,id) { const row=await db.prepare("SELECT front_r2_key FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first(); if(!row) throw new Error('找不到收藏名片'); if(row.front_r2_key) await bucket.delete(row.front_r2_key); await db.prepare("UPDATE contact_cards SET status='archived',front_r2_key='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?").bind(id,userId).run(); }

export async function serveContactImage(db,bucket,request,userId,id) { const row=await db.prepare("SELECT front_r2_key,front_content_type FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first(); if(!row?.front_r2_key)return new Response('Not found',{status:404}); const object=await bucket.get(row.front_r2_key); if(!object)return new Response('Not found',{status:404}); return new Response(request.method==='HEAD'?null:object.body,{headers:{'content-type':object.httpMetadata?.contentType||row.front_content_type||'image/webp','cache-control':'private, max-age=300','x-content-type-options':'nosniff'}}); }

export async function collectPublicCard(db,userId,personalCardId) {
  const source=await db.prepare("SELECT * FROM personal_cards WHERE id=? AND status='published'").bind(personalCardId).first(); if(!source)throw new Error('名片不存在或尚未公開'); if(source.platform_user_id===userId){const error=new Error('這是你自己的名片');error.code='self_card';throw error;}
  const existing=await db.prepare("SELECT * FROM contact_cards WHERE scanner_user_id=? AND source_personal_card_id=? AND status='active'").bind(userId,personalCardId).first(); if(existing)return {card:rowToCard(existing),duplicate:true};
  const card=cleanCard({displayName:source.display_name,englishName:source.english_name,companyName:source.company_name,jobTitle:source.job_title,department:source.department,mobile:source.mobile,companyPhone:source.company_phone,email:source.email,websiteUrl:source.website_url,lineUrl:source.line_url,address:source.address,serviceDescription:source.service_description});
  const duplicate=await findDuplicate(db,userId,card); if(duplicate)return {card:rowToCard(duplicate),duplicate:true};
  const id=newId('contact'); const versionsJson=withInsightMeta({},{status:'queued',cards:{},error:''}); await db.prepare('INSERT INTO contact_cards (id,scanner_user_id,source_type,source_personal_card_id,bound_user_id,display_name,english_name,company_name,job_title,department,mobile,company_phone,email,website_url,line_url,address,service_description,normalized_mobile,normalized_email,normalized_name_company,versions_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,userId,'public_card',personalCardId,source.platform_user_id,card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany,versionsJson).run(); return {card:rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first()),duplicate:false};
}

function randomShareToken() {
  const bytes=crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}

export async function createContactShare(db,userId,contactId,origin) {
  const card=await db.prepare("SELECT id,display_name FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(contactId,userId).first();
  if(!card)throw new Error('找不到收藏名片');
  const token=randomShareToken();
  await db.batch([
    db.prepare("UPDATE contact_card_shares SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE contact_card_id=? AND owner_user_id=? AND status='active'").bind(contactId,userId),
    db.prepare("INSERT INTO contact_card_shares (id,contact_card_id,owner_user_id,token_hash) VALUES (?,?,?,?)").bind(newId('contact_share'),contactId,userId,await sha256(token)),
  ]);
  return { url:`${origin}/d/${token}`, displayName:card.display_name };
}

export async function revokeContactShare(db,userId,contactId) {
  const result=await db.prepare("UPDATE contact_card_shares SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE contact_card_id=? AND owner_user_id=? AND status='active'").bind(contactId,userId).run();
  return { revoked:Number(result.meta?.changes || 0)>0 };
}

async function sharedContactRow(db,rawToken) {
  const token=String(rawToken||'').trim();
  if(!/^[a-f0-9]{48}$/i.test(token))return null;
  return db.prepare(`SELECT cc.* FROM contact_card_shares ccs JOIN contact_cards cc ON cc.id=ccs.contact_card_id
    WHERE ccs.token_hash=? AND ccs.status='active' AND cc.status='active' LIMIT 1`).bind(await sha256(token)).first();
}

export async function getSharedContact(db,rawToken) {
  const row=await sharedContactRow(db,rawToken);
  if(!row)return null;
  // 僅以明確 allowlist 輸出；私人備註、收藏者、來源、內部 ID 與時間均不公開。
  const versions = parseVersions(row); const selectedVersion = CARD_VERSIONS.includes(row.selected_version) ? row.selected_version : 'standard'; const selected = versions[selectedVersion];
  return { displayName:row.display_name,englishName:row.english_name,companyName:row.company_name,jobTitle:row.job_title,department:row.department,mobile:row.mobile,companyPhone:row.company_phone,email:row.email,websiteUrl:row.website_url,lineUrl:row.line_url,address:row.address,serviceDescription:row.service_description,chatAltText:row.chat_alt_text || DEFAULT_CHAT_ALT_TEXT,selectedVersion,versions,coverUrl:selected.coverUrl,buttons:selected.buttons,hasImage:Boolean(row.front_r2_key) };
}

export async function serveSharedContactImage(db,bucket,request,rawToken) {
  const row=await sharedContactRow(db,rawToken);
  if(!row?.front_r2_key)return new Response('Not found',{status:404});
  const object=await bucket.get(row.front_r2_key);if(!object)return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:object.body,{headers:{'content-type':object.httpMetadata?.contentType||row.front_content_type||'image/webp','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}});
}
