import { randomBytes, createHash } from 'node:crypto';
import { db, today } from './db.js';
import { hashPassword } from './auth.js';
import { activatePremium } from './billing.js';
import { notifyStatusChange } from './notify.js';
import { removeJobFiles } from './jobs.js';
import { publicUrl } from './lib/mailer.js';
import { sendClientMessage, mailTemplateList, notifyClient, previewClientMessage } from './lib/client-mail.js';
import { createViewSession } from './lib/view-session.js';
import { loginEventsFor } from './lib/auth-events.js';
import { requireAdmin, requireStaff, paging, sendCsv, like, dateOnly } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { logEvent } from './lib/app-log.js';

const ROLES = ['user', 'support', 'admin'];
const SESSION_RE = /^[a-f0-9]{32}$/;
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
  mustChangePassword: Boolean(u.must_change_password),
  twoFactorEnabled: Boolean(u.totp_enabled)
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
  if (['free', 'start', 'pro', 'business', 'enterprise'].includes(plan)) {
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
  app.get('/api/admin/users', { preHandler: requireStaff }, async (req) => {
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

  app.get('/api/admin/users/export.csv', { preHandler: requireStaff }, async (req, reply) => {
    const { whereSql, params } = userFilters(req.query);
    const rows = db.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.plan, u.status, u.created_at, u.last_login_at,
        (SELECT expires_at FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' ORDER BY expires_at DESC LIMIT 1) AS premium_until
      FROM users u ${whereSql} ORDER BY u.id DESC LIMIT 10000
    `).all(...params);
    return sendCsv(reply, 'code-qr-users.csv',
      ['ID', 'Email', 'Имя', 'Роль', 'Тариф', 'Статус', 'Регистрация', 'Последний вход', 'Подписка до'],
      rows.map((u) => [u.id, u.email, u.name, u.role, u.plan, u.status, u.created_at, u.last_login_at || '', u.premium_until || ''])
    );
  });

  // Карточка клиента: всё, что нужно для решения по нему
  app.get('/api/admin/users/:id', { preHandler: requireStaff }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const subscription = activeSub(user.id);
    const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 20').all(user.id);
    const orders = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id);
    const jobs = db.prepare('SELECT id,name,mode,format,status,total,valid,done,error,created_at,finished_at FROM generation_jobs WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id);
    const apiKeys = db.prepare('SELECT id,name,prefix,created_at,last_used_at FROM api_keys WHERE user_id=? ORDER BY id DESC').all(user.id);
    const sessions = db.prepare("SELECT public_id, created_at, expires_at, ip, user_agent FROM sessions WHERE user_id=? AND expires_at > datetime('now') ORDER BY created_at DESC").all(user.id);
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
    audit(req, 'user.block', 'user', user.id, { reason });
    const notified = await notifyClient(user, 'account_blocked', { reason });
    return { ok: true, notified, user: publicAdminUser(getUser(user.id)) };
  });

  app.post('/api/admin/users/:id/unblock', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    db.prepare("UPDATE users SET status='active', blocked_at=NULL, blocked_reason='' WHERE id=?").run(user.id);
    notifyStatusChange(user, 'Администратор разблокировал аккаунт');
    audit(req, 'user.unblock', 'user', user.id, {});
    const notified = await notifyClient(user, 'access_restored', {});
    return { ok: true, notified, user: publicAdminUser(getUser(user.id)) };
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
    const before = user.role;
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, user.id);
    notifyStatusChange(user, 'Администратор изменил роль: ' + role);
    audit(req, 'user.role', 'user', user.id, { from: before, to: role });
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
    audit(req, 'user.password_reset', 'user', user.id, {});
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
      try { await removeJobFiles(job.id); } catch { /* файлы могли быть уже удалены */ }
    }
    db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    audit(req, 'user.delete', 'user', user.id, { email: user.email, jobs: jobs.length });
    return { ok: true, deleted: { id: user.id, email: user.email } };
  });

  // Завершить все сессии клиента
  app.delete('/api/admin/users/:id/sessions', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const r = db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    audit(req, 'session.kill_all', 'user', user.id, { removed: r.changes });
    return { ok: true, removed: r.changes };
  });

  // Завершить конкретную сессию
  // ── Быстрая помощь клиенту ─────────────────────────────────────────────
  app.get('/api/admin/users/:id/diagnostics', { preHandler: requireStaff }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const email = user.email.toLowerCase();
    const attempts = db.prepare('SELECT fails, locked_until, last_at FROM login_attempts WHERE email=?').get(email) || null;
    const locked = attempts?.locked_until
      ? Boolean(db.prepare("SELECT ? > datetime('now') AS locked").get(attempts.locked_until).locked)
      : false;
    const sessions = db.prepare(
      "SELECT public_id, ip, user_agent, created_at, last_used_at FROM sessions WHERE user_id=? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 10"
    ).all(user.id);
    const ips = [...new Set(sessions.map((s) => s.ip).filter(Boolean))];
    const rateLimits = ips.length
      ? db.prepare(`SELECT key, count, window_start FROM rate_limits WHERE key IN (${ips.map(() => '?').join(',')})`)
        .all(...ips.map((ip) => 'ip:' + ip))
        .map((r) => ({ ip: String(r.key).replace(/^ip:/, ''), count: r.count, windowStart: r.window_start }))
      : [];
    const usage = db.prepare('SELECT codes_generated FROM usage_daily WHERE user_id=? AND day=?').get(user.id, today());
    const lastActions = db.prepare(
      "SELECT action, meta, ip, created_at FROM audit_log WHERE target_type='user' AND target_id=? ORDER BY id DESC LIMIT 10"
    ).all(String(user.id));
    const loginLinks = db.prepare(
      "SELECT created_at, expires_at, used_at FROM login_links WHERE user_id=? ORDER BY id DESC LIMIT 5"
    ).all(user.id);
    return {
      locked,
      fails: attempts?.fails || 0,
      lockedUntil: locked ? attempts.locked_until : null,
      lastFailAt: attempts?.last_at || null,
      twoFactorEnabled: Boolean(user.totp_enabled),
      mustChangePassword: Boolean(user.must_change_password),
      status: user.status,
      plan: user.plan,
      usageToday: usage?.codes_generated || 0,
      sessions,
      ips,
      rateLimits,
      loginLinks,
      logins: loginEventsFor(user.id, 30),
      lastActions
    };
  });

  // Шаблоны писем клиенту (для формы «Написать клиенту»).
  app.get('/api/admin/mail-templates', { preHandler: requireAdmin }, async () => ({ templates: mailTemplateList() }));

  // Предпросмотр фирменного письма без отправки.
  app.get('/api/admin/users/:id/mail-preview', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const preview = previewClientMessage(user, {
      template: String(req.query?.template || 'custom'),
      subject: String(req.query?.subject || '').slice(0, 200),
      text: String(req.query?.text || '').slice(0, 5000)
    });
    return { subject: preview.subject, html: preview.html };
  });

  // Письмо клиенту по шаблону или своё сообщение.
  app.post('/api/admin/users/:id/message', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const template = String(req.body?.template || 'custom');
    try {
      const r = await sendClientMessage(user, {
        template,
        subject: req.body?.subject,
        text: req.body?.text,
        vars: {
          until: activeSub(user.id)?.expires_at ? String(activeSub(user.id).expires_at).slice(0, 10) : '',
          days: Number(req.body?.days) || undefined,
          reason: String(req.body?.reason || '').slice(0, 200)
        }
      });
      audit(req, 'user.message', 'user', user.id, { template, subject: r.subject });
      return { ok: true, subject: r.subject };
    } catch (e) {
      logEvent({
        level: 'warn', source: 'mail', event: 'admin_mail_failed',
        message: `Письмо клиенту не отправлено (${user.email}): ${String(e?.message || e)}`,
        userId: user.id, ip: req.ip, method: 'ADMIN', url: req.url,
        meta: { template }
      });
      return reply.code(400).send({ error: String(e?.message || e) });
    }
  });

  // Компенсация за инцидент: продлить PRO и (опционально) написать клиенту.
  app.post('/api/admin/users/:id/compensate', { preHandler: requireAdmin }, async (req, reply) => {
    const days = Math.round(Number(req.body?.days));
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      return reply.code(400).send({ error: 'Компенсация: от 1 до 90 дней' });
    }
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const reason = String(req.body?.reason || '').slice(0, 200);
    activatePremium(user.id, 'compensation', null, null, days);
    const sub = activeSub(user.id);
    notifyStatusChange(user, `Компенсация: PRO продлён на ${days} дн.${reason ? ' (' + reason + ')' : ''}`);
    const notified = await notifyClient(user, 'compensation', { days, reason, until: sub?.expires_at ? String(sub.expires_at).slice(0, 10) : '' });
    audit(req, 'user.compensate', 'user', user.id, { days, reason, notified });
    return { ok: true, days, premiumUntil: sub?.expires_at || null, notified };
  });

  // Отозвать все API-ключи клиента (утечка ключа, смена интегратора).
  app.post('/api/admin/users/:id/revoke-api-keys', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const r = db.prepare('DELETE FROM api_keys WHERE user_id=?').run(user.id);
    audit(req, 'user.revoke_api_keys', 'user', user.id, { removed: r.changes });
    return { ok: true, removed: r.changes };
  });

  // Просмотр «как клиент»: ссылка открывает отдельную read-only сессию,
  // админская сессия при этом не сбрасывается.
  app.post('/api/admin/users/:id/impersonate', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return reply.code(400).send({ error: 'Свой аккаунт смотреть не нужно' });
    if (user.status === 'blocked') return reply.code(400).send({ error: 'Аккаунт заблокирован' });
    const view = createViewSession(req.user.id, user.id);
    audit(req, 'user.view_as', 'user', user.id, { expiresAt: view.expiresAt });
    return {
      ok: true,
      url: `${publicUrl().replace(/\/$/, '')}/api/admin/view/${view.token}`,
      expiresAt: view.expiresAt,
      warning: 'Откроется только чтение на 30 минут. Выход — кнопка «Выйти» или закрытие вкладки.'
    };
  });

  // Снять блокировку входа после неудачных попыток.
  app.post('/api/admin/users/:id/unlock-login', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const before = db.prepare('SELECT fails, locked_until FROM login_attempts WHERE email=?').get(user.email.toLowerCase());
    db.prepare('DELETE FROM login_attempts WHERE email=?').run(user.email.toLowerCase());
    const notified = await notifyClient(user, 'access_restored', {});
    audit(req, 'user.unlock_login', 'user', user.id, { fails: before?.fails || 0, lockedUntil: before?.locked_until || null, notified });
    return { ok: true, clearedFails: before?.fails || 0, notified };
  });

  // Сброс 2FA: клиент потерял телефон. Сессии завершаются, вход — по паролю.
  app.post('/api/admin/users/:id/reset-2fa', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return reply.code(400).send({ error: 'Свою 2FA отключайте в разделе «Безопасность»' });
    if (!user.totp_enabled) return reply.code(400).send({ error: 'У клиента 2FA не включена' });
    db.transaction(() => {
      db.prepare("UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup='[]' WHERE id=?").run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    })();
    notifyStatusChange(user, 'Администратор сбросил двухфакторную аутентификацию — включите её заново в разделе «Безопасность».');
    const notified = await notifyClient(user, 'twofa_reset', {});
    audit(req, 'user.reset_2fa', 'user', user.id, { notified });
    return { ok: true, notified, user: publicAdminUser(getUser(user.id)) };
  });

  // Обнулить дневной лимит кодов (клиенту нужно срочно продолжить работу).
  app.post('/api/admin/users/:id/reset-usage', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const before = db.prepare('SELECT codes_generated FROM usage_daily WHERE user_id=? AND day=?').get(user.id, today());
    db.prepare('DELETE FROM usage_daily WHERE user_id=? AND day=?').run(user.id, today());
    audit(req, 'user.reset_usage', 'user', user.id, { codesToday: before?.codes_generated || 0 });
    return { ok: true, usageToday: 0, cleared: before?.codes_generated || 0 };
  });

  // Снять требование сменить пароль при входе.
  app.post('/api/admin/users/:id/clear-password-flag', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return reply.code(400).send({ error: 'Для себя флаг не снимается' });
    if (!user.must_change_password) return reply.code(400).send({ error: 'Флаг и так снят' });
    db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(user.id);
    audit(req, 'user.clear_password_flag', 'user', user.id, {});
    return { ok: true, user: publicAdminUser(getUser(user.id)) };
  });

  // Сбросить rate-limit для IP, с которых клиент заходил (ошибка 429).
  app.post('/api/admin/users/:id/clear-rate-limits', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const ips = db.prepare("SELECT DISTINCT ip FROM sessions WHERE user_id=? AND ip <> ''").all(user.id).map((r) => r.ip);
    const extra = String(req.body?.ip || '').trim().slice(0, 60);
    if (extra) ips.push(extra);
    const unique = [...new Set(ips)].slice(0, 50);
    let removed = 0;
    for (const ip of unique) removed += db.prepare('DELETE FROM rate_limits WHERE key=?').run('ip:' + ip).changes;
    audit(req, 'user.clear_rate_limits', 'user', user.id, { ips: unique, removed });
    return { ok: true, removed, ips: unique };
  });

  // Одноразовая ссылка входа: админ копирует и отправляет клиенту.
  app.post('/api/admin/users/:id/login-link', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return reply.code(400).send({ error: 'Для себя ссылку выдавать не нужно' });
    if (user.status === 'blocked') return reply.code(400).send({ error: 'Аккаунт заблокирован — сначала разблокируйте' });
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    const expires = db.prepare("SELECT datetime('now','+15 minutes') t").get().t;
    db.transaction(() => {
      db.prepare('DELETE FROM login_links WHERE user_id=? AND used_at IS NULL').run(user.id);
      db.prepare('INSERT INTO login_links (user_id, token_hash, expires_at, created_by) VALUES (?,?,?,?)')
        .run(user.id, hash, expires, req.user.id);
    })();
    audit(req, 'user.login_link', 'user', user.id, { expiresAt: expires });
    return {
      ok: true,
      url: `${publicUrl().replace(/\/$/, '')}/api/auth/link/${token}`,
      expiresAt: expires,
      warning: 'Ссылка действует 15 минут и заменяет пароль и 2FA — отправляйте только владельцу аккаунта.'
    };
  });

  // Завершить конкретную сессию
  app.delete('/api/admin/sessions/:publicId', { preHandler: requireAdmin }, async (req, reply) => {
    const publicId = String(req.params.publicId || '');
    if (!SESSION_RE.test(publicId)) return reply.code(400).send({ error: 'Некорректный идентификатор сессии' });
    const session = db.prepare('SELECT user_id FROM sessions WHERE public_id=?').get(publicId);
    const r = db.prepare('DELETE FROM sessions WHERE public_id=?').run(publicId);
    if (!r.changes) return reply.code(404).send({ error: 'Сессия не найдена' });
    audit(req, 'session.kill', 'user', session?.user_id || '', { id: publicId.slice(0, 8) });
    return { ok: true };
  });
}

