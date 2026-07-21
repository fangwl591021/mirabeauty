const ANALYSIS_VERSION='line-fate-v1';
const OUTPUT_KEYS = {Personality:'personality',Hobbies:'interests',Wealth:'wealth',Health:'health',Career:'career'};
const INSIGHT_KEYS = Object.values(OUTPUT_KEYS);
const INSIGHTS_SCHEMA = {
  type:'object',
  additionalProperties:false,
  required:Object.keys(OUTPUT_KEYS),
  properties:Object.fromEntries(Object.keys(OUTPUT_KEYS).map((key)=>[key,{type:'string',minLength:20,maxLength:60}])),
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
    analysisVersion:text(row.analysis_version,40),
  };
}

export async function getMemberCrmInsight(db,userId) {
  return memberCrmInsightFromRow(await db.prepare('SELECT * FROM member_crm_insights WHERE platform_user_id=?').bind(userId).first());
}

export async function queueMemberCrmInsight(db,userId) {
  await db.prepare(`INSERT INTO member_crm_insights (platform_user_id,status,insights_json,last_error)
    VALUES (?,'queued','{}','') ON CONFLICT(platform_user_id) DO UPDATE SET
    status='queued',insights_json='{}',last_error='',analysis_version='',updated_at=CURRENT_TIMESTAMP`).bind(userId).run();
}

async function memberFacts(db,userId) {
  return db.prepare(`SELECT mp.display_name,mp.phone,mp.birthday,
      pc.company_name,pc.job_title,pc.department,pc.service_description
    FROM member_profiles mp LEFT JOIN personal_cards pc ON pc.platform_user_id=mp.platform_user_id
    WHERE mp.platform_user_id=?`).bind(userId).first();
}

async function generateMemberCrmInsights(db,userId,apiKey,model) {
  const source=await memberFacts(db,userId);
  if(!source)throw new Error('找不到會員資料');
  const facts={name:text(source.display_name,120),mobile:text(source.phone,40).replace(/[^0-9+]/g,''),birthday:text(source.birthday,10),company:text(source.company_name,180),title:text(source.job_title,120)};
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
    body:JSON.stringify({
      model:model || 'gpt-5.6-terra',reasoning:{effort:'low'},max_output_tokens:900,
      input:[{role:'user',content:`你是一位專業的商務 AI 心理與命理分析專家。請完全依照 LINE- 專案的五大標籤規則，根據姓名用字、手機號碼頻率與尾數、生日、公司及職稱，進行商務人格分析。\n\n姓名：${facts.name || '未知'}\n手機：${facts.mobile || '未知'}\n生日：${facts.birthday || '未知'}\n公司：${facts.company || '未知'}\n職稱：${facts.title || '未知'}\n\n分析邏輯與必含維度：\n1. 始終依姓名字形判斷行動／思考型、發音判斷外向／內斂、結構判斷主導／依附。\n2. 手機號碼依數字頻率分析（1領導、2協調、3表達、4穩定、5自由、6責任、7分析、8成就、9理想），以尾數判斷快攻／慢養決策模式，以奇偶比判斷衝動／保守。\n3. 有生日時，融合八字、紫微斗數、生命靈數與東西方星座學，分析先天傾向、潛能與目前適合的商務互動方式；資料不足時不可虛構精確命盤。\n4. 五項結果必須明確融合：VAK 感官接收偏好（視覺／聽覺／觸覺）、思考與決策模式（分析／數據／直覺）、行為與風險偏好（積極／消極、冒險／保守）。\n5. Personality、Hobbies、Wealth、Health、Career 每項必須為 20 至 40 個繁體中文字的完整情境描述，同時包含具體特徵與商務應對建議，不得只給單詞。\n6. Wealth 不得宣稱實際收入或資產；Health 不得診斷疾病；不可捏造獎項、客戶、年資、家庭、宗教或政治資訊。\n\n只回傳符合指定格式的 JSON。`}],
      text:{format:{type:'json_schema',name:'member_crm_five_insights',strict:true,schema:INSIGHTS_SCHEMA}},
    }),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result?.error?.message || '會員 CRM 五大標籤暫時無法使用');
  const outputText=result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type==='output_text')?.text;
  if(!outputText)throw new Error('AI 未回傳會員 CRM 五大標籤');
  const parsed=JSON.parse(outputText);
  return Object.fromEntries(Object.entries(OUTPUT_KEYS).map(([outputKey,storageKey])=>[storageKey,text(parsed[outputKey],220)]));
}

export async function processMemberCrmInsight(db,userId,apiKey,model) {
  await db.prepare(`INSERT INTO member_crm_insights (platform_user_id,status,insights_json,last_error)
    VALUES (?,'processing','{}','') ON CONFLICT(platform_user_id) DO UPDATE SET
    status='processing',last_error='',updated_at=CURRENT_TIMESTAMP`).bind(userId).run();
  try {
    const cards=await generateMemberCrmInsights(db,userId,apiKey,model);
    await db.prepare("UPDATE member_crm_insights SET status='ready',insights_json=?,last_error='',analysis_version=?,updated_at=CURRENT_TIMESTAMP WHERE platform_user_id=?").bind(JSON.stringify(cards),ANALYSIS_VERSION,userId).run();
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
      mci.platform_user_id IS NULL
      OR (COALESCE(mci.analysis_version,'')!=? AND mci.status NOT IN ('queued','processing'))
      OR mci.status='failed'
      OR (mci.status='queued' AND mci.updated_at<=datetime('now','-10 minutes'))
      OR (mci.status='processing' AND mci.updated_at<=datetime('now','-30 minutes'))
    ) ORDER BY COALESCE(mci.updated_at,mp.updated_at) ASC LIMIT ?`).bind(ANALYSIS_VERSION,cappedLimit).all();
  const tasks=(result.results || []).map((row)=>({userId:row.platform_user_id}));
  if(tasks.length)await db.batch(tasks.map((task)=>db.prepare(`INSERT INTO member_crm_insights (platform_user_id,status,insights_json,last_error)
    VALUES (?,'queued','{}','') ON CONFLICT(platform_user_id) DO UPDATE SET status='queued',last_error='',analysis_version='',updated_at=CURRENT_TIMESTAMP`).bind(task.userId)));
  return tasks;
}
