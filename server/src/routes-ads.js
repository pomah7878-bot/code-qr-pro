import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADS_DIR = process.env.ADS_DIR || join(__dirname, '..', 'data', 'ads');
const PLACEMENTS = new Set(['landing_banner', 'app_banner']);
const STATUSES = new Set(['draft', 'active', 'paused', 'ended']);

function adRow(r) {
  return {
    id: r.id,
    advertiser: r.advertiser,
    title: r.title,
    text: r.text,
    imageUrl: r.image_key ? `/api/ads/${r.id}/image?v=${encodeURIComponent(r.updated_at || '')}` : '',
    targetUrl: r.target_url,
    placement: r.placement,
    status: r.status,
    price: Number(r.price) || 0,
    paid: Boolean(r.paid),
    paidAt: r.paid_at,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    impressionLimit: Number(r.impression_limit) || 0,
    clickLimit: Number(r.click_limit) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function validUrl(value) {
  try {
    const u = new URL(String(value));
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : '';
  } catch { return ''; }
}

function dateValue(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T.+?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.replace('T', ' ').slice(0, 19);
  return null;
}

function saveImage(id, dataUrl) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw Object.assign(new Error('Нужна картинка PNG, JPEG или WebP'), { statusCode: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2_500_000) throw Object.assign(new Error('Картинка больше 2,5 МБ'), { statusCode: 400 });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  mkdirSync(ADS_DIR, { recursive: true, mode: 0o700 });
  const key = `${id}-${Date.now()}.${ext}`;
  writeFileSync(join(ADS_DIR, key), buf, { mode: 0o600 });
  return key;
}

function bodyToAd(body = {}) {
  const target = validUrl(body.targetUrl);
  if (!String(body.advertiser || '').trim()) throw Object.assign(new Error('Укажите рекламодателя'), { statusCode: 400 });
  if (!String(body.title || '').trim()) throw Object.assign(new Error('Укажите заголовок объявления'), { statusCode: 400 });
  if (!target) throw Object.assign(new Error('Ссылка должна начинаться с http:// или https://'), { statusCode: 400 });
  const placement = PLACEMENTS.has(body.placement) ? body.placement : 'landing_banner';
  const status = STATUSES.has(body.status) ? body.status : 'draft';
  const price = Math.min(10_000_000, Math.max(0, Number(body.price) || 0));
  const starts = dateValue(body.startsAt);
  const ends = dateValue(body.endsAt);
  if (starts && ends && ends <= starts) throw Object.assign(new Error('Дата окончания должна быть позже начала'), { statusCode: 400 });
  return {
    advertiser: String(body.advertiser).trim().slice(0, 160),
    title: String(body.title).trim().slice(0, 200),
    text: String(body.text || '').trim().slice(0, 600),
    targetUrl: target,
    placement,
    status,
    price,
    paid: body.paid ? 1 : 0,
    startsAt: starts,
    endsAt: ends,
    impressionLimit: Math.max(0, Math.min(100_000_000, Math.round(Number(body.impressionLimit) || 0))),
    clickLimit: Math.max(0, Math.min(10_000_000, Math.round(Number(body.clickLimit) || 0)))
  };
}

export async function registerAdRoutes(app) {
  app.get('/api/admin/ads', { preHandler: requireAdmin }, async () => {
    const ads = db.prepare('SELECT * FROM ad_campaigns ORDER BY id DESC').all().map(adRow);
    const totals = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='active' AND paid=1 THEN 1 ELSE 0 END) AS active,
      COALESCE(SUM(CASE WHEN paid=1 THEN price ELSE 0 END),0) AS revenue,
      COALESCE(SUM(impressions),0) AS impressions,
      COALESCE(SUM(clicks),0) AS clicks
      FROM ad_campaigns`).get();
    return { ads, totals };
  });

  app.post('/api/admin/ads', { preHandler: requireAdmin }, async (req, reply) => {
    let data;
    try { data = bodyToAd(req.body); } catch (e) { return reply.code(e.statusCode || 400).send({ error: e.message }); }
    const info = db.prepare(`INSERT INTO ad_campaigns
      (advertiser,title,text,target_url,placement,status,price,paid,paid_at,starts_at,ends_at,impression_limit,click_limit)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      data.advertiser, data.title, data.text, data.targetUrl, data.placement, data.status,
      data.price, data.paid, data.paid ? db.prepare("SELECT datetime('now') t").get().t : null,
      data.startsAt, data.endsAt, data.impressionLimit, data.clickLimit
    );
    const id = Number(info.lastInsertRowid);
    if (req.body?.image) {
      try {
        const key = saveImage(id, req.body.image);
        db.prepare('UPDATE ad_campaigns SET image_key=? WHERE id=?').run(key, id);
      } catch (e) {
        db.prepare('DELETE FROM ad_campaigns WHERE id=?').run(id);
        return reply.code(e.statusCode || 400).send({ error: e.message });
      }
    }
    audit(req, 'ad.create', 'ad', String(id), { title: data.title, placement: data.placement, price: data.price });
    return { ad: adRow(db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(id)) };
  });

  app.put('/api/admin/ads/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const old = db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(req.params.id);
    if (!old) return reply.code(404).send({ error: 'Кампания не найдена' });
    let data;
    try { data = bodyToAd(req.body); } catch (e) { return reply.code(e.statusCode || 400).send({ error: e.message }); }
    let imageKey = old.image_key;
    try {
      if (req.body?.removeImage) {
        if (imageKey) { try { unlinkSync(join(ADS_DIR, imageKey)); } catch { /* ignore */ } }
        imageKey = null;
      } else if (req.body?.image) {
        const nextKey = saveImage(old.id, req.body.image);
        if (imageKey) { try { unlinkSync(join(ADS_DIR, imageKey)); } catch { /* ignore */ } }
        imageKey = nextKey;
      }
    } catch (e) { return reply.code(e.statusCode || 400).send({ error: e.message }); }
    const paidAt = data.paid ? (old.paid ? old.paid_at : db.prepare("SELECT datetime('now') t").get().t) : null;
    db.prepare(`UPDATE ad_campaigns SET
      advertiser=?, title=?, text=?, image_key=?, target_url=?, placement=?, status=?, price=?, paid=?, paid_at=?,
      starts_at=?, ends_at=?, impression_limit=?, click_limit=?, updated_at=datetime('now')
      WHERE id=?`).run(
      data.advertiser, data.title, data.text, imageKey, data.targetUrl, data.placement, data.status,
      data.price, data.paid, paidAt, data.startsAt, data.endsAt, data.impressionLimit, data.clickLimit, old.id
    );
    audit(req, 'ad.update', 'ad', String(old.id), { title: data.title, status: data.status, paid: data.paid });
    return { ad: adRow(db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(old.id)) };
  });

  app.delete('/api/admin/ads/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const ad = db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(req.params.id);
    if (!ad) return reply.code(404).send({ error: 'Кампания не найдена' });
    if (ad.image_key) { try { unlinkSync(join(ADS_DIR, ad.image_key)); } catch { /* ignore */ } }
    db.prepare('DELETE FROM ad_campaigns WHERE id=?').run(ad.id);
    audit(req, 'ad.delete', 'ad', String(ad.id), { title: ad.title });
    return { ok: true };
  });

  // Публичная выдача объявления для конкретного места
  app.get('/api/ads/slot', async (req, reply) => {
    const placement = PLACEMENTS.has(req.query?.placement) ? req.query.placement : 'landing_banner';
    const ad = db.prepare(`SELECT * FROM ad_campaigns
      WHERE placement=? AND status='active' AND paid=1
        AND (starts_at IS NULL OR starts_at <= datetime('now'))
        AND (ends_at IS NULL OR ends_at > datetime('now'))
        AND (impression_limit = 0 OR impressions < impression_limit)
        AND (click_limit = 0 OR clicks < click_limit)
      ORDER BY RANDOM() LIMIT 1`).get(placement);
    if (!ad) return { ad: null };
    const r = adRow(ad);
    return {
      ad: { id: r.id, title: r.title, text: r.text, imageUrl: r.imageUrl, targetUrl: `/api/ads/${r.id}/click`, advertiser: r.advertiser }
    };
  });

  app.get('/api/ads/:id/image', async (req, reply) => {
    const ad = db.prepare('SELECT image_key FROM ad_campaigns WHERE id=?').get(req.params.id);
    if (!ad?.image_key) return reply.code(404).send({ error: 'Картинка не найдена' });
    const path = join(ADS_DIR, ad.image_key);
    if (!existsSync(path)) return reply.code(404).send({ error: 'Картинка не найдена' });
    const ext = ad.image_key.split('.').pop();
    const type = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.type(type).send(readFileSync(path));
  });

  app.post('/api/ads/:id/impression', async (req, reply) => {
    const ad = db.prepare(`SELECT id FROM ad_campaigns
      WHERE id=? AND status='active' AND paid=1
        AND (starts_at IS NULL OR starts_at <= datetime('now'))
        AND (ends_at IS NULL OR ends_at > datetime('now'))
        AND (impression_limit = 0 OR impressions < impression_limit)`).get(req.params.id);
    if (!ad) return { ok: false };
    db.prepare('UPDATE ad_campaigns SET impressions=impressions+1 WHERE id=?').run(ad.id);
    db.prepare(`INSERT INTO ad_daily_stats (ad_id, day, impressions, clicks) VALUES (?, date('now'), 1, 0)
      ON CONFLICT(ad_id, day) DO UPDATE SET impressions=impressions+1`).run(ad.id);
    return { ok: true };
  });

  app.get('/api/ads/:id/click', async (req, reply) => {
    const ad = db.prepare(`SELECT * FROM ad_campaigns
      WHERE id=? AND status='active' AND paid=1
        AND (starts_at IS NULL OR starts_at <= datetime('now'))
        AND (ends_at IS NULL OR ends_at > datetime('now'))
        AND (click_limit = 0 OR clicks < click_limit)`).get(req.params.id);
    if (!ad) return reply.code(404).send({ error: 'Объявление неактивно' });
    db.prepare('UPDATE ad_campaigns SET clicks=clicks+1 WHERE id=?').run(ad.id);
    db.prepare(`INSERT INTO ad_daily_stats (ad_id, day, impressions, clicks) VALUES (?, date('now'), 0, 1)
      ON CONFLICT(ad_id, day) DO UPDATE SET clicks=clicks+1`).run(ad.id);
    const url = validUrl(ad.target_url);
    if (!url) return reply.code(404).send({ error: 'Ссылка недоступна' });
    return reply.redirect(url);
  });
}
