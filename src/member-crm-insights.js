const INSIGHT_KEYS = ['personality','interests','wealth','health','career'];
const INSIGHTS_SCHEMA = {
  type:'object',
  additionalProperties:false,
  required:INSIGHT_KEYS,
  properties:Object.fromEntries(INSIGHT_KEYS.map((key)=>[key,{type:'string'}])),
};
const text=(value,max=1000)=>String(value || '').trim().slice(0,max);

export function memberCrmInsightFromRow(row = {}) {
  let cards={};
  try { cards=JSON.parse(row.insights_json || '{}') || {}; } catch {}
  return {
    status:['queued','processing','ready','failed'].includes(row.status) ? row.status : '',
    cards:Object.fromEntries(INSIGHT_KEYS.map((key)=>[key,text(cards[key],220)])),
    error:text(row.last_error,180),
    updatedAt:text(row.updated_at,80),
  };
}

export async function getMemberCrmInsight(db,userId) {
  return memberCrmInsightFromRow(await db.prepare('SELECT * FROM member_crm_insights WHERE platform_user_id=?').bind(userId).first());
}

export async function queueMemberCrmInsight(db,userId) {
  await db.prepare(`INSERT INTO member_crm_insights (platform_user_id,status,insights_json,last_error)
    VALUES (?,'queued','{}','') ON CONFLICT(platform_user_id) DO UPDATE SET
    status='queued',insights_json='{}',last_error='',updated_at=CURRENT_TIMESTAMP`).bind(userId).run();
}

async function memberFacts(db,userId) {
  return db.prepare(`SELECT mp.display_name,mp.gender,mp.birthday,mp.industry,mp.address,
      pc.company_name,pc.job_title,pc.department,pc.service_description
    FROM member_profiles mp LEFT JOIN personal_cards pc ON pc.platform_user_id=mp.platform_user_id
    WHERE mp.platform_user_id=?`).bind(userId).first();
}

async function generateMemberCrmInsights(db,userId,apiKey,model) {
  const source=await memberFacts(db,userId);
  if(!source)throw new Error('找不到會員資料');
  const facts={
    name:text(source.display_name,120),
    gender:text(source.gender,30),
    birthday:text(source.birthday,10),
    industry:text(source.industry,120),
    address:text(source.address,300),
    company:text(source.company_name,180),
    title:text(source.job_title,120),
    department:text(source.department,120),
    service:text(source.service_description,1600),
  };
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
    body:JSON.stringify({
      model:model || 'gpt-5.6-terra',reasoning:{effort:'low'},max_output_tokens:900,
      input:[{role:'user',content:`你是繁體中文會員 CRM 助手。請只依下列會員自行提供的基本資料與公開名片欄位，產出五項業務互動參考。\n\n${JSON.stringify(facts)}\n\n規則：\n- 每項 45 到 90 個繁體中文字，內容不足時明確說明需於後續互動補充，不可捏造。\n- 個性：只描述可能適合的溝通方式，不做心理診斷。\n- 興趣：只依業種、職務或服務推測可能關注的商務議題，不推論私人嗜好。\n- 財富：不可推論收入、資產、消費力或投資能力，只描述可能重視的商務價值與合作效益。\n- 健康：不可推論疾病或健康狀態，只提供工作節奏、活動參與及關懷方式建議。\n- 事業：聚焦專業定位、合作切入點及後續跟進方向。\n- 不得捏造獎項、客戶、年資、家庭、宗教、政治、醫療或財務資訊。只回傳 JSON。`}],
      text:{format:{type:'json_schema',name:'member_crm_five_insights',strict:true,schema:INSIGHTS_SCHEMA}},
    }),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result?.error?.message || '會員 CRM 五大標籤暫時無法使用');
  const outputText=result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type==='output_text')?.text;
  if(!outputText)throw new Error('AI 未回傳會員 CRM 五大標籤');
  const parsed=JSON.parse(outputText);
  return Object.fromEntries(INSIGHT_KEYS.map((key)=>[key,text(parsed[key],220)]));
}

export async function processMemberCrmInsight(db,userId,apiKey,model) {
  await db.prepare(`INSERT INTO member_crm_insights (platform_user_id,status,insights_json,last_error)
    VALUES (?,'processing','{}','') ON CONFLICT(platform_user_id) DO UPDATE SET
    status='processing',last_error='',updated_at=CURRENT_TIMESTAMP`).bind(userId).run();
  try {
    const cards=await generateMemberCrmInsights(db,userId,apiKey,model);
    await db.prepare("UPDATE member_crm_insights SET status='ready',insights_json=?,last_error='',updated_at=CURRENT_TIMESTAMP WHERE platform_user_id=?").bind(JSON.stringify(cards),userId).run();
  } catch(error) {
    await db.prepare("UPDATE member_crm_insights SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE platform_user_id=?").bind(text(error.message || '分析失敗',180),userId).run();
    console.error('Member CRM insight analysis failed',error);
  }
}

export async function queueSystemMemberCrmInsightBackfill(db,limit=6) {
  const cappedLimit=Math.max(1,Math.min(Number(limit) || 6,20));
  const result=await db.prepare(`SELECT mp.platform_user_id FROM member_profiles mp
    LEFT JOIN member_crm_insights mci ON mci.platform_user_id=mp.platform_user_id
    WHERE mp.profile_completed_at IS NOT NULL AND mp.profile_completed_at!='' AND (
      mci.platform_user_id IS NULL OR mci.status='failed'
      OR (mci.status='queued' AND mci.updated_at<=datetime('now','-10 minutes'))
      OR (mci.status='processing' AND mci.updated_at<=datetime('now','-30 minutes'))
    ) ORDER BY COALESCE(mci.updated_at,mp.updated_at) ASC LIMIT ?`).bind(cappedLimit).all();
  const tasks=(result.results || []).map((row)=>({userId:row.platform_user_id}));
  if(tasks.length)await db.batch(tasks.map((task)=>db.prepare(`INSERT INTO member_crm_insights (platform_user_id,status,insights_json,last_error)
    VALUES (?,'queued','{}','') ON CONFLICT(platform_user_id) DO UPDATE SET status='queued',last_error='',updated_at=CURRENT_TIMESTAMP`).bind(task.userId)));
  return tasks;
}
