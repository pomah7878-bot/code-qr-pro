import { db } from './db.js';
import { requireAdmin, paging, like, dateOnly } from './lib/admin.js';

export async function registerAdminAuditRoutes(app) {
  app.get('/api/admin/audit', { preHandler: requireAdmin }, async (req) => {
    const { page, per, offset } = paging(req.query, 50);
    const where = [];
    const params = [];
    const action = String(req.query?.action || '').trim().slice(0, 80);
    if (action) {
      where.push("action LIKE ? ESCAPE '\\'");
      params.push(like(action));
    }
    const actor = String(req.query?.actor || '').trim().slice(0, 120);
    if (actor) {
      where.push("actor_email LIKE ? ESCAPE '\\'");
      params.push(like(actor));
    }
    const from = dateOnly(req.query?.from);
    const to = dateOnly(req.query?.to);
    if (from) {
      where.push('date(created_at) >= date(?)');
      params.push(from);
    }
    if (to) {
      where.push('date(created_at) <= date(?)');
      params.push(to);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const entries = db.prepare(
      `SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...params, per, offset);
    const total = db.prepare(`SELECT COUNT(*) c FROM audit_log ${whereSql}`).get(...params).c;
    const actions = db.prepare('SELECT action, COUNT(*) c FROM audit_log GROUP BY action ORDER BY c DESC LIMIT 40').all();
    return {
      entries: entries.map((e) => ({
        id: e.id,
        actorId: e.actor_id,
        actorEmail: e.actor_email,
        actorRole: e.actor_role,
        action: e.action,
        targetType: e.target_type,
        targetId: e.target_id,
        meta: e.meta,
        ip: e.ip,
        createdAt: e.created_at
      })),
      actions,
      total,
      page,
      per,
      pages: Math.max(1, Math.ceil(total / per))
    };
  });
}
