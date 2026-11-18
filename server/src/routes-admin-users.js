import { randomBytes } from 'node:crypto';
import { db, today } from './db.js';
import { hashPassword } from './auth.js';
import { activatePremium } from './billing.js';
import { notifyStatusChange } from './notify.js';
import { removeJobFiles } from './jobs.js';
import { requireAdmin, paging, sendCsv, like, dateOnly } from './lib/admin.js';

const ROLES = ['user', 'support', 'admin'];
const SESSION_RE = /^[a-f0-9]{64}$/;
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

const adminCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const activeSub = (userId) => db.prepare(
  "SELECT * FROM subscriptions WHERE user_id=? AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1"
).get(userId);

const publicAdminUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  plan: u.plan,
  status: u.status,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at,
  blockedAt: u.blocked_at,
  blockedReason: u.blocked_reason,
  note: u.note,
  mustChangePassword: Boolean(u.must_change_password)
});

function tempPassword(len = 12) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}

function userFilters(query) {
  const where = [];
  const params = [];
  const q = String(query?.q || '').trim().slice(0, 120);
  if (q) {
    const l = like(q);
    const parts = ["u.email LIKE ? ESCAPE '\\'", "u.name LIKE ? ESCAPE '\\'"];
    params.push(l, l);
    if (/^\d{1,12}$/.test(q)) {
      parts.push('u.id = ?');
      params.push(Number(q));
    }
    where.push('(' + parts.join(' OR ') + ')');
  }
  const plan = String(query?.plan || '');
  if (['free', 'premium'].includes(plan)) {
    where.push('u.plan = ?');
    params.push(plan);
  }
  const role = String(query?.role || '');
  if (ROLES.includes(role)) {
    where.push('u.role = ?');
    params.push(role);
  }
  const status = String(query?.status || '');
  if (['active', 'blocked'].includes(status)) {
    where.push('u.status = ?');
    params.push(status);
  }
  const from = dateOnly(query?.from);
  const to = dateOnly(query?.to);
  if (from) {
    where.push('date(u.created_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(u.created_at) <= date(?)');
    params.push(to);
  }
  return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

export async function registerAdminUserRoutes(app) {
  // Список клиентов: поиск, фильтры, пагинация
  app.get('/api/admin/users', { preHandler: requireAdmin }, async (req) => {
    const { page, per, offset } = paging(req.query);
    const { whereSql, params } = userFilters(req.query);
    const users = db.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.plan, u.status, u.created_at, u.last_login_at,
        (SELECT expires_at FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' ORDER BY expires_at DESC LIMIT 1) AS premium_until,
        COALESCE(d.codes_generated, 0) AS codes_today,
        (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.user_id=u.id AND o.status='paid') AS paid_total,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status='paid') AS paid_orders
      FROM users u
      LEFT JOIN usage_daily d ON d.user_id=u.id AND d.day=?
      ${whereSql}
      ORDER BY u.id DESC
      LIMIT ? OFFSET ?
    `).all(today(), ...params, per, offset);
    const total = db.prepare(`SELECT COUNT(*) c FROM users u ${whereSql}`).get(...params).c;
    return { users, total, page, per, pages: Math.max(1, Math.ceil(total / per)) };
  });

  app.get('/api/admin/users/export.csv', { preHandler: requireAdmin }, async (req, reply) => {
    const { whereSql, params } = userFilters(req.query);
    const rows = db.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.plan, u.status, u.created_at, u.last_login_at,
        (SELECT expires_at FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' ORDER BY expires_at DESC LIMIT 1) AS premium_until
      FROM users u ${whereSql} ORDER BY u.id DESC LIMIT 10000
    `).all(...params);
    return sendCsv(reply, 'code-qr-users.csv',
      ['ID', 'Email', 'Имя', 'Роль', 'Тариф', 'Статус', 'Регистрация', 'Последний вход', 'PREMIUM до'],
      rows.map((u) => [u.id, u.email, u.name, u.role, u.plan, u.status, u.created_at, u.last_login_at || '', u.premium_until || ''])
    );
  });

  // Карточка клиента: всё, что нужно для решения по нему
  app.get('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const subscription = activeSub(user.id);
    const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 20').all(user.id);
    const orders = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id);
    const jobs = db.prepare('SELECT id,name,mode,format,status,total,valid,done,error,created_at,finished_at FROM generation_jobs WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id);
    const apiKeys = db.prepare('SELECT id,name,prefix,created_at,last_used_at FROM api_keys WHERE user_id=? ORDER BY id DESC').all(user.id);
    const sessions = db.prepare("SELECT token, created_at, expires_at FROM sessions WHERE user_id=? AND expires_at > datetime('now') ORDER BY created_at DESC").all(user.id);
    const review = db.prepare('SELECT id,rating,text,status,created_at FROM reviews WHERE user_id=?').get(user.id) || null;
    return {
      user: publicAdminUser(user),
      subscription: subscription || null,
      premiumUntil: subscription?.expires_at || null,
      subscriptions,
      orders,
      jobs,
      apiKeys,
      sessions,
      review
    };
  });

  // Выдать или продлить PREMIUM на произвольный срок
  app.post('/api/admin/users/:id/grant', { preHandler: requireAdmin }, async (req, reply) => {
    const days = Math.round(Number(req.body?.days));
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return reply.code(400).send({ error: 'Срок: от 1 до 3650 дней' });
    }
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    activatePremium(user.id, 'admin', null, null, days);
    notifyStatusChange(user, `Администратор выдал PREMIUM на ${days} дн.`);
    const sub = activeSub(user.id);
    return { ok: true, premiumUntil: sub?.expires_at || null, user: publicAdminUser(getUser(user.id)) };
  });

  app.post('/api/admin/users/:id/revoke', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    db.transaction(() => {
      db.prepare("UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'").run(user.id);
      db.prepare("UPDATE users SET plan='free' WHERE id=?").run(user.id);
    })();
    notifyStatusChange(user, 'Администратор снял PREMIUM');
    return { ok: true, user: publicAdminUser(getUser(user.id)) };
  });

  // Блокировка: сессии удаляются, вход запрещён
  app.post('/api/admin/users/:id/block', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return reply.code(400).send({ error: 'Себя блокировать нельзя' });
    if (user.role === 'admin' && adminCount() <= 1) {
      return reply.code(400).send({ error: 'Нельзя блокировать последнего администратора' });
    }
    const reason = String(req.body?.reason || '').trim().slice(0, 200);
    db.transaction(() => {
      db.prepare("UPDATE users SET status='blocked', blocked_at=datetime('now'), blocked_reason=? WHERE id=?").run(reason, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    })();
    notifyStatusChange(user, 'Администратор заблокировал аккаунт' + (reason ? ': ' + reason : ''));
    return { ok: true, user: publicAdminUser(getUser(user.id)) };
  });

  app.post('/api/admin/users/:id/unblock', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    db.prepare("UPDATE users SET status='active', blocked_at=NULL, blocked_reason='' WHERE id=?").run(user.id);
    notifyStatusChange(user, 'Администратор разблокировал аккаунт');
    return { ok: true, user: publicAdminUser(getUser(user.id)) };
  });

  app.post('/api/admin/users/:id/role', { preHandler: requireAdmin }, async (req, reply) => {
    const role = String(req.body?.role || '');
    if (!ROLES.includes(role)) return reply.code(400).send({ error: 'Роль: user, support или admin' });
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return reply.code(400).send({ error: 'Свою роль менять нельзя' });
    if (user.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
      return reply.code(400).send({ error: 'Нельзя снять последнего администратора' });
    }
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, user.id);
    notifyStatusChange(user, 'Администратор изменил роль: ' + role);
    return { ok: true, user: publicAdminUser(getUser(user.id)) };
  });

  // Временный пароль: показывается один раз, при входе требуется смена
  app.post('/api/admin/users/:id/password-reset', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return reply.code(400).send({ error: 'Свой пароль меняется в профиле' });
    const password = tempPassword(12);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?')
        .run(hashPassword(password), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    })();
    notifyStatusChange(user, 'Администратор сбросил пароль — потребуется смена при входе');
    return { ok: true, password, warning: 'Пароль показывается один раз — передайте его клиенту' };
  });

  app.post('/api/admin/users/:id/note', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const note = String(req.body?.note || '').trim().slice(0, 1000);
    db.prepare('UPDATE users SET note=? WHERE id=?').run(note, user.id);
    return { ok: true, note };
  });

  // Полное удаление: каскад из схемы + файлы заданий
  app.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return reply.code(400).send({ error: 'Удалить свой аккаунт из админки нельзя' });
    if (user.role === 'admin' && adminCount() <= 1) {
      return reply.code(400).send({ error: 'Нельзя удалить последнего администратора' });
    }
    const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();
    if (confirmEmail !== user.email.toLowerCase()) {
      return reply.code(400).send({ error: 'Введите email клиента для подтверждения удаления' });
    }
    const jobs = db.prepare('SELECT id FROM generation_jobs WHERE user_id=?').all(user.id);
    for (const job of jobs) {
      try { removeJobFiles(job.id); } catch { /* файлы могли быть уже удалены */ }
    }
    db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    return { ok: true, deleted: { id: user.id, email: user.email } };
  });

  // Завершить все сессии клиента
  app.delete('/api/admin/users/:id/sessions', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const r = db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    return { ok: true, removed: r.changes };
  });

  // Завершить конкретную сессию
  app.delete('/api/admin/sessions/:token', { preHandler: requireAdmin }, async (req, reply) => {
    const token = String(req.params.token || '');
    if (!SESSION_RE.test(token)) return reply.code(400).send({ error: 'Некорректный идентификатор сессии' });
    const r = db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    if (!r.changes) return reply.code(404).send({ error: 'Сессия не найдена' });
    return { ok: true };
  });
}
