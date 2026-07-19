import { newId } from './member-repository.js';
import { sha256 } from './auth.js';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FIELD_LIMITS = { displayName:120, englishName:120, companyName:180, jobTitle:120, department:120, mobile:40, companyPhone:40, email:320, websiteUrl:2048, lineUrl:2048, address:300, serviceDescription:1600, note:1000 };
const text = (value, max = 1000) => String(value || '').trim().slice(0, max);
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

function rowToCard(row) {
  if (!row) return null;
  return { id:row.id, sourceType:row.source_type, sourcePersonalCardId:row.source_personal_card_id || '', displayName:row.display_name, englishName:row.english_name, companyName:row.company_name, jobTitle:row.job_title, department:row.department, mobile:row.mobile, companyPhone:row.company_phone, email:row.email, websiteUrl:row.website_url, lineUrl:row.line_url, address:row.address, serviceDescription:row.service_description, note:row.note, hasImage:Boolean(row.front_r2_key), createdAt:row.created_at, updatedAt:row.updated_at };
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
  if (duplicate) await db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(...values,id,userId).run();
  else await db.prepare('INSERT INTO contact_cards (id,scanner_user_id,source_event_id,display_name,english_name,company_name,job_title,department,mobile,company_phone,email,website_url,line_url,address,service_description,note,normalized_mobile,normalized_email,normalized_name_company,front_r2_key,front_content_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,userId,eventId,...values,sourceKey,event.front_content_type).run();
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
  await db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany,id,userId).run();
  return rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first());
}

export async function deleteContact(db,bucket,userId,id) { const row=await db.prepare("SELECT front_r2_key FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first(); if(!row) throw new Error('找不到收藏名片'); if(row.front_r2_key) await bucket.delete(row.front_r2_key); await db.prepare("UPDATE contact_cards SET status='archived',front_r2_key='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?").bind(id,userId).run(); }

export async function serveContactImage(db,bucket,request,userId,id) { const row=await db.prepare("SELECT front_r2_key,front_content_type FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first(); if(!row?.front_r2_key)return new Response('Not found',{status:404}); const object=await bucket.get(row.front_r2_key); if(!object)return new Response('Not found',{status:404}); return new Response(request.method==='HEAD'?null:object.body,{headers:{'content-type':object.httpMetadata?.contentType||row.front_content_type||'image/webp','cache-control':'private, max-age=300','x-content-type-options':'nosniff'}}); }

export async function collectPublicCard(db,userId,personalCardId) {
  const source=await db.prepare("SELECT * FROM personal_cards WHERE id=? AND status='published'").bind(personalCardId).first(); if(!source)throw new Error('名片不存在或尚未公開'); if(source.platform_user_id===userId){const error=new Error('這是你自己的名片');error.code='self_card';throw error;}
  const existing=await db.prepare("SELECT * FROM contact_cards WHERE scanner_user_id=? AND source_personal_card_id=? AND status='active'").bind(userId,personalCardId).first(); if(existing)return {card:rowToCard(existing),duplicate:true};
  const card=cleanCard({displayName:source.display_name,englishName:source.english_name,companyName:source.company_name,jobTitle:source.job_title,department:source.department,mobile:source.mobile,companyPhone:source.company_phone,email:source.email,websiteUrl:source.website_url,lineUrl:source.line_url,address:source.address,serviceDescription:source.service_description});
  const duplicate=await findDuplicate(db,userId,card); if(duplicate)return {card:rowToCard(duplicate),duplicate:true};
  const id=newId('contact'); await db.prepare('INSERT INTO contact_cards (id,scanner_user_id,source_type,source_personal_card_id,bound_user_id,display_name,english_name,company_name,job_title,department,mobile,company_phone,email,website_url,line_url,address,service_description,normalized_mobile,normalized_email,normalized_name_company) VALUES (?,?,\'public_card\',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,userId,personalCardId,source.platform_user_id,card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany).run(); return {card:rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first()),duplicate:false};
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
  return { displayName:row.display_name,englishName:row.english_name,companyName:row.company_name,jobTitle:row.job_title,department:row.department,mobile:row.mobile,companyPhone:row.company_phone,email:row.email,websiteUrl:row.website_url,lineUrl:row.line_url,address:row.address,serviceDescription:row.service_description,hasImage:Boolean(row.front_r2_key) };
}

export async function serveSharedContactImage(db,bucket,request,rawToken) {
  const row=await sharedContactRow(db,rawToken);
  if(!row?.front_r2_key)return new Response('Not found',{status:404});
  const object=await bucket.get(row.front_r2_key);if(!object)return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:object.body,{headers:{'content-type':object.httpMetadata?.contentType||row.front_content_type||'image/webp','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}});
}
