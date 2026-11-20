import { db } from './db.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { allowlistRows, refreshAllowlist, validIp } from './lib/allowlist.js';

/**
 * Безопасность: админ видит и снимает защитные лимиты, чтобы быстро помочь клиенту.
 * Это не «выключение защиты» — записи просто удаляются, счётчики начинаются заново.
 */
export async function registerAdminSecurityRoutes(app) {
  // IP, которые сейчас упираются в лимит запросов (429).
  app.get('/api/admin/security/rate-limits', { preHandler: requireAdmin }, async () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = db.prepare('SELECT key, count, window_start FROM rate_limits ORDER BY count DESC, window_start DESC LIMIT 100').all();
    return {
      limits: rows.map((r) => ({
        ip: String(r.key).replace(/^ip:/, ''),
        count: Number(r.count) || 0,
        ageSec: Math.max(0, now - Number(r.window_start || now))
      }))
    };
  });

  app.delete('/api/admin/security/rate-limits/:ip', { preHandler: requireAdmin }, async (req, reply) => {
    const ip = String(req.params.ip || '').trim().slice(0, 60);
    if (!ip) return reply.code(400).send({ error: 'Укажите IP' });
    const r = db.prepare('DELETE FROM rate_limits WHERE key=?').run('ip:' + ip);
    if (!r.changes) return reply.code(404).send({ error: 'Для этого IP лимита нет' });
    audit(req, 'security.rate_limit_clear', 'ip', ip, {});
    return { ok: true };
  });

  app.delete('/api/admin/security/rate-limits', { preHandler: requireAdmin }, async (req) => {
    const r = db.prepare('DELETE FROM rate_limits').run();
    audit(req, 'security.rate_limit_clear_all', 'ip', '', { removed: r.changes });
    return { ok: true, removed: r.changes };
  });

  // Заблокированные входы (5 неудачных попыток → 15 минут).
  app.get('/api/admin/security/login-locks', { preHandler: requireAdmin }, async () => {
    const rows = db.prepare(
      `SELECT a.email, a.fails, a.locked_until, a.last_at, u.id AS user_id, u.status
       FROM login_attempts a LEFT JOIN users u ON u.email = a.email
       WHERE a.locked_until IS NOT NULL AND a.locked_until > datetime('now')
       ORDER BY a.locked_until DESC LIMIT 100`
    ).all();
    return { locks: rows };
  });

  app.delete('/api/admin/security/login-locks/:email', { preHandler: requireAdmin }, async (req, reply) => {
    const email = String(req.params.email || '').trim().toLowerCase().slice(0, 200);
    if (!email) return reply.code(400).send({ error: 'Укажите email' });
    const r = db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
    if (!r.changes) return reply.code(404).send({ error: 'Блокировки для этого email нет' });
    audit(req, 'security.login_lock_clear', 'email', email, {});
    return { ok: true };
  });

  app.delete('/api/admin/security/login-locks', { preHandler: requireAdmin }, async (req) => {
    const r = db.prepare('DELETE FROM login_attempts').run();
    audit(req, 'security.login_lock_clear_all', 'email', '', { removed: r.changes });
    return { ok: true, removed: r.changes };
  });

  // Белый список IP: такие адреса не упираются в антиспам (офис, склад, интегратор).
  app.get('/api/admin/security/allowlist', { preHandler: requireAdmin }, async () => ({ ips: allowlistRows() }));

  app.post('/api/admin/security/allowlist', { preHandler: requireAdmin }, async (req, reply) => {
    const ip = String(req.body?.ip || '').trim().slice(0, 60);
    if (!validIp(ip)) return reply.code(400).send({ error: 'Некорректный IP-адрес' });
    const note = String(req.body?.note || '').trim().slice(0, 200);
    try {
      db.prepare('INSERT INTO ip_allowlist (ip, note, created_by) VALUES (?,?,?)').run(ip, note, req.user.id);
    } catch {
      return reply.code(409).send({ error: 'Этот IP уже в белом списке' });
    }
    refreshAllowlist();
    audit(req, 'security.allowlist_add', 'ip', ip, { note });
    return { ok: true, ip };
  });

  app.delete('/api/admin/security/allowlist/:ip', { preHandler: requireAdmin }, async (req, reply) => {
    const ip = String(req.params.ip || '').trim().slice(0, 60);
    const r = db.prepare('DELETE FROM ip_allowlist WHERE ip=?').run(ip);
    if (!r.changes) return reply.code(404).send({ error: 'Этого IP нет в белом списке' });
    refreshAllowlist();
    audit(req, 'security.allowlist_remove', 'ip', ip, {});
    return { ok: true };
  });
}
