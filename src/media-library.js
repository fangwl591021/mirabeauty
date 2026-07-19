import { newId } from './member-repository.js';

const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_POSTER_BYTES = 1024 * 1024;

function safeFileName(value) {
  let decoded = String(value || 'video.mp4');
  try { decoded = decodeURIComponent(decoded); } catch {}
  return decoded.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').trim().slice(0, 180) || 'video.mp4';
}

function assetPayload(row, origin = '') {
  return {
    id: row.id,
    name: row.original_name || '未命名影片',
    contentType: row.content_type || 'video/mp4',
    sizeBytes: Number(row.size_bytes || 0),
    durationSeconds: Number(row.duration_seconds || 0),
    status: row.status || 'ready',
    referenceCount: Number(row.reference_count || 0),
    createdAt: row.created_at || '',
    videoUrl: origin ? `${origin}/v1/media/${encodeURIComponent(row.id)}/video` : '',
    posterUrl: row.poster_r2_key && origin ? `${origin}/v1/media/${encodeURIComponent(row.id)}/poster` : '',
  };
}

async function removeR2Asset(db, bucket, row) {
  if (!row || row.status === 'deleted') return;
  await db.prepare("UPDATE media_assets SET status = 'deleting', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
  try {
    const keys = [row.r2_key, row.poster_r2_key].filter(Boolean);
    if (keys.length) await bucket.delete(keys);
    await db.prepare("UPDATE media_assets SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
  } catch (error) {
    await db.prepare("UPDATE media_assets SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
    throw error;
  }
}

async function deleteIfUnused(db, bucket, assetIds) {
  const ids = [...new Set((assetIds || []).filter(Boolean))];
  for (const id of ids) {
    const row = await db.prepare(`SELECT ma.*, (SELECT COUNT(*) FROM media_asset_references mar WHERE mar.asset_id = ma.id) AS reference_count
      FROM media_assets ma WHERE ma.id = ? AND ma.status = 'ready'`).bind(id).first();
    if (row && Number(row.reference_count || 0) === 0) await removeR2Asset(db, bucket, row);
  }
}

export async function listMediaAssets(db, bucket, origin) {
  const stale = await db.prepare(`SELECT ma.* FROM media_assets ma
    WHERE ma.status = 'ready' AND ma.created_at < datetime('now', '-1 day')
      AND NOT EXISTS (SELECT 1 FROM media_asset_references mar WHERE mar.asset_id = ma.id)
    LIMIT 25`).all();
  for (const row of stale.results || []) await removeR2Asset(db, bucket, row).catch(() => null);
  const rows = await db.prepare(`SELECT ma.*, COUNT(mar.asset_id) AS reference_count
    FROM media_assets ma LEFT JOIN media_asset_references mar ON mar.asset_id = ma.id
    WHERE ma.status = 'ready' GROUP BY ma.id ORDER BY ma.created_at DESC LIMIT 200`).all();
  return (rows.results || []).map(row => assetPayload(row, origin));
}

export async function uploadVideoAsset(db, bucket, actorUserId, request, origin) {
  if (!bucket) throw new Error('尚未設定 R2 MEDIA bucket');
  const contentType = String(request.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const size = Number(request.headers.get('content-length') || 0);
  if (contentType !== 'video/mp4') throw new Error('影片僅支援 MP4 格式');
  if (!Number.isInteger(size) || size <= 0) throw new Error('無法確認影片容量，請重新選擇檔案');
  if (size > MAX_VIDEO_BYTES) throw new Error('影片不可超過 80MB');
  if (!request.body) throw new Error('缺少影片內容');
  const id = newId('media_video');
  const key = `videos/${id}.mp4`;
  const name = safeFileName(request.headers.get('x-file-name') || 'video.mp4');
  const duration = Math.max(0, Math.min(86400, Number(request.headers.get('x-duration-seconds') || 0)));
  const stored = await bucket.put(key, request.body, {
    httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { assetId: id, originalName: name },
  });
  try {
    await db.prepare(`INSERT INTO media_assets
      (id, r2_key, original_name, content_type, size_bytes, duration_seconds, status, created_by_user_id)
      VALUES (?, ?, ?, 'video/mp4', ?, ?, 'ready', ?)`)
      .bind(id, key, name, Number(stored?.size || size), duration, actorUserId).run();
  } catch (error) {
    await bucket.delete(key).catch(() => null);
    throw error;
  }
  const row = await db.prepare('SELECT *, 0 AS reference_count FROM media_assets WHERE id = ?').bind(id).first();
  return assetPayload(row, origin);
}

export async function uploadVideoPoster(db, bucket, assetId, request, origin) {
  if (!bucket) throw new Error('尚未設定 R2 MEDIA bucket');
  const row = await db.prepare("SELECT * FROM media_assets WHERE id = ? AND status = 'ready'").bind(assetId).first();
  if (!row) throw new Error('找不到影片');
  const contentType = String(request.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const size = Number(request.headers.get('content-length') || 0);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('封面僅支援 JPG、PNG 或 WebP');
  if (!Number.isInteger(size) || size <= 0 || size > MAX_POSTER_BYTES) throw new Error('影片封面不可超過 1MB');
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const key = `posters/${assetId}.${extension}`;
  await bucket.put(key, request.body, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } });
  if (row.poster_r2_key && row.poster_r2_key !== key) await bucket.delete(row.poster_r2_key).catch(() => null);
  await db.prepare("UPDATE media_assets SET poster_r2_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(key, assetId).run();
  const updated = await db.prepare(`SELECT ma.*, (SELECT COUNT(*) FROM media_asset_references WHERE asset_id = ma.id) AS reference_count FROM media_assets ma WHERE id = ?`).bind(assetId).first();
  return assetPayload(updated, origin);
}

export async function deleteMediaAsset(db, bucket, assetId) {
  const row = await db.prepare(`SELECT ma.*, (SELECT COUNT(*) FROM media_asset_references WHERE asset_id = ma.id) AS reference_count FROM media_assets ma WHERE id = ?`).bind(assetId).first();
  if (!row || row.status === 'deleted') throw new Error('找不到影片');
  if (Number(row.reference_count || 0) > 0) throw new Error(`影片仍被 ${row.reference_count} 個活動頁面使用，請先從活動移除`);
  await removeR2Asset(db, bucket, row);
  return { success: true };
}

export async function syncTemplateMediaReferences(db, bucket, templateId, pages, active) {
  if (active) {
    for (const page of pages || []) {
      if (page.mediaType !== 'video' || !page.mediaAssetId) continue;
      const asset = await db.prepare("SELECT id FROM media_assets WHERE id = ? AND status = 'ready'").bind(page.mediaAssetId).first();
      if (!asset) throw new Error(`影片「${page.mediaAssetId}」不存在或已被刪除`);
    }
  }
  const previous = await db.prepare('SELECT DISTINCT asset_id FROM media_asset_references WHERE template_id = ?').bind(templateId).all();
  await db.prepare('DELETE FROM media_asset_references WHERE template_id = ?').bind(templateId).run();
  if (active) {
    for (const page of pages || []) {
      if (page.mediaType !== 'video' || !page.mediaAssetId) continue;
      await db.prepare('INSERT OR IGNORE INTO media_asset_references (asset_id, template_id, page_id) VALUES (?, ?, ?)').bind(page.mediaAssetId, templateId, page.id).run();
    }
  }
  await deleteIfUnused(db, bucket, (previous.results || []).map(row => row.asset_id));
}

export async function removeTemplateMediaReferences(db, bucket, templateId) {
  const previous = await db.prepare('SELECT DISTINCT asset_id FROM media_asset_references WHERE template_id = ?').bind(templateId).all();
  await db.prepare('DELETE FROM media_asset_references WHERE template_id = ?').bind(templateId).run();
  await deleteIfUnused(db, bucket, (previous.results || []).map(row => row.asset_id));
}

export async function serveMediaAsset(db, bucket, request, assetId, variant) {
  if (!bucket) return new Response('Media storage unavailable', { status: 503 });
  const row = await db.prepare("SELECT * FROM media_assets WHERE id = ? AND status = 'ready'").bind(assetId).first();
  if (!row) return new Response('Not found', { status: 404 });
  const key = variant === 'poster' ? row.poster_r2_key : row.r2_key;
  if (!key) return new Response('Not found', { status: 404 });
  const onlyHead = request.method === 'HEAD';
  const object = onlyHead ? await bucket.head(key) : await bucket.get(key, { range: request.headers });
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (object.range) {
    headers.set('content-range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    headers.set('content-length', String(object.range.length));
  } else headers.set('content-length', String(object.size));
  return new Response(onlyHead ? null : object.body, { status: object.range ? 206 : 200, headers });
}
