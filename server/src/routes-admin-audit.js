import { db } from './db.js';
import { requireAdmin, paging, like, dateOnly } from './lib/admin.js';
import { audit } from './lib/audit.js';

const QA_WHERE = "actor_email LIKE 'qa-%'";

export async function registerAdminAuditRoutes(app) {
  app.get('/api/admin/audit/clear-preview', { preHandler: requireAdmin }, async () => {
    const total = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
    const qa = db.prepare('SELECT COUNT(*) c FROM audit_log WHERE ' + QA_WHERE).get().c;
    const range = db.prepare("SELECT MIN(created_at) a, MAX(created_at) b FROM audit_log WHERE " + QA_WHERE).get() || {};
    return {
      total,
      qa,
      real: Math.max(0, total - qa),
      qaFrom: range.a || '',
      qaTo: range.b || '',
      warning: 'Журнал аудита фиксирует действия администраторов. Его удаление снижает возможность разбора инцидентов; безопаснее очищать только тестовые записи QA.'
    };
  });

  app.post('/api/admin/audit/clear', { preHandler: requireAdmin }, async (req, reply) => {
    const phrase = String(req.body?.confirm || '').trim().toUpperCase();
    if (phrase !== 'ОЧИСТИТЬ ЖУРНАЛ') return reply.code(400).send({ error: 'Введите контрольную фразу: ОЧИСТИТЬ ЖУРНАЛ' });
    const scope = req.body?.scope === 'all' ? 'all' : 'qa';
    if (scope === 'all' && req.body?.acknowledge !== true) return reply.code(400).send({ error: 'Подтвердите очистку всего журнала' });
    const count = db.prepare(scope === 'all' ? 'SELECT COUNT(*) c FROM audit_log' : 'SELECT COUNT(*) c FROM audit_log WHERE ' + QA_WHERE).get().c;
    if (!count) return { ok: true, deleted: 0 };
    if (scope === 'all') db.prepare('DELETE FROM audit_log').run();
    else db.prepare('DELETE FROM audit_log WHERE ' + QA_WHERE).run();
    audit(req, 'audit.clear', 'audit_log', scope, { scope, deleted: count });
    return { ok: true, deleted: count, scope };
  });

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
