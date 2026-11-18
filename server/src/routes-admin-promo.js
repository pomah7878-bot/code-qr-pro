import { db } from './db.js';
import { normalizePromoCode } from './lib/promo.js';
import { requireAdmin, paging } from './lib/admin.js';
import { audit } from './lib/audit.js';

const KINDS = ['percent', 'fixed', 'days'];

const mapPromo = (p) => ({
  id: p.id,
  code: p.code,
  kind: p.kind,
  value: p.value,
  maxUses: p.max_uses,
  usedCount: p.used_count,
  perUserLimit: p.per_user_limit,
  startsAt: p.starts_at,
  expiresAt: p.expires_at,
  active: Boolean(p.active),
  note: p.note,
  createdAt: p.created_at
});

function toSqlDate(value, edge) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + (edge === 'end' ? ' 23:59:59' : ' 00:00:00');
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(s)) return s.replace('T', ' ') + ':00';
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) return s.replace('T', ' ');
  return null;
}

function parsePromo(body) {
  const code = normalizePromoCode(body?.code);
  if (!code) return { error: 'Код: 3–32 символа — A-Z, 0-9, _ и -' };
  const kind = KINDS.includes(body?.kind) ? body.kind : 'percent';
  const value = Math.round(Number(body?.value) * 100) / 100;
  const max = kind === 'percent' ? 90 : kind === 'days' ? 365 : 1000000;
  if (!Number.isFinite(value) || value < 1 || value > max) return { error: `Значение: от 1 до ${max}` };
  const maxUses = Math.max(0, Math.min(100000, Math.round(Number(body?.maxUses) || 0)));
  const perUserLimit = Math.max(0, Math.min(100, Math.round(Number(body?.perUserLimit) || 0)));
  const startsAt = toSqlDate(body?.startsAt, 'start');
  const expiresAt = toSqlDate(body?.expiresAt, 'end');
  if (body?.startsAt && !startsAt) return { error: 'Некорректная дата начала' };
  if (body?.expiresAt && !expiresAt) return { error: 'Некорректная дата окончания' };
  if (startsAt && expiresAt && startsAt > expiresAt) return { error: 'Дата начала позже даты окончания' };
  return {
    row: {
      code, kind, value, maxUses, perUserLimit, startsAt, expiresAt,
      active: body?.active === false ? 0 : 1,
      note: String(body?.note || '').slice(0, 200)
    }
  };
}

export async function registerAdminPromoRoutes(app) {
  app.get('/api/admin/promo', { preHandler: requireAdmin }, async () => ({
    promos: db.prepare('SELECT * FROM promo_codes ORDER BY id DESC LIMIT 200').all().map(mapPromo)
  }));

  app.post('/api/admin/promo', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = parsePromo(req.body);
    if (parsed.error) return reply.code(400).send({ error: parsed.error });
    const p = parsed.row;
    const exists = db.prepare('SELECT id FROM promo_codes WHERE code=?').get(p.code);
    if (exists) return reply.code(409).send({ error: 'Такой код уже есть' });
    const info = db.prepare(`INSERT INTO promo_codes
      (code, kind, value, max_uses, per_user_limit, starts_at, expires_at, active, note)
      VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(p.code, p.kind, p.value, p.maxUses, p.perUserLimit, p.startsAt, p.expiresAt, p.active, p.note);
    audit(req, 'promo.create', 'promo', info.lastInsertRowid, { code: p.code, kind: p.kind, value: p.value });
    return { promo: mapPromo(db.prepare('SELECT * FROM promo_codes WHERE id=?').get(info.lastInsertRowid)) };
  });

  app.put('/api/admin/promo/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const promo = db.prepare('SELECT * FROM promo_codes WHERE id=?').get(req.params.id);
    if (!promo) return reply.code(404).send({ error: 'Промокод не найден' });
    const parsed = parsePromo(req.body);
    if (parsed.error) return reply.code(400).send({ error: parsed.error });
    const p = parsed.row;
    const clash = db.prepare('SELECT id FROM promo_codes WHERE code=? AND id<>?').get(p.code, promo.id);
    if (clash) return reply.code(409).send({ error: 'Такой код уже есть' });
    db.prepare(`UPDATE promo_codes SET code=?, kind=?, value=?, max_uses=?, per_user_limit=?,
      starts_at=?, expires_at=?, active=?, note=? WHERE id=?`
    ).run(p.code, p.kind, p.value, p.maxUses, p.perUserLimit, p.startsAt, p.expiresAt, p.active, p.note, promo.id);
    audit(req, 'promo.update', 'promo', promo.id, { code: p.code, active: p.active });
    return { promo: mapPromo(db.prepare('SELECT * FROM promo_codes WHERE id=?').get(promo.id)) };
  });

  app.delete('/api/admin/promo/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const promo = db.prepare('SELECT * FROM promo_codes WHERE id=?').get(req.params.id);
    if (!promo) return reply.code(404).send({ error: 'Промокод не найден' });
    db.prepare('DELETE FROM promo_codes WHERE id=?').run(promo.id);
    audit(req, 'promo.delete', 'promo', promo.id, { code: promo.code, used: promo.used_count });
    return { ok: true };
  });

  app.get('/api/admin/promo/:id/redemptions', { preHandler: requireAdmin }, async (req, reply) => {
    const promo = db.prepare('SELECT * FROM promo_codes WHERE id=?').get(req.params.id);
    if (!promo) return reply.code(404).send({ error: 'Промокод не найден' });
    const { page, per, offset } = paging(req.query, 50);
    const rows = db.prepare(`
      SELECT r.id, r.created_at, u.email, o.id AS order_id, o.amount
      FROM promo_redemptions r
      JOIN users u ON u.id=r.user_id
      LEFT JOIN orders o ON o.id=r.order_id
      WHERE r.promo_id=? ORDER BY r.id DESC LIMIT ? OFFSET ?
    `).all(promo.id, per, offset);
    const total = db.prepare('SELECT COUNT(*) c FROM promo_redemptions WHERE promo_id=?').get(promo.id).c;
    return { promo: mapPromo(promo), redemptions: rows, total, page, per };
  });
}
