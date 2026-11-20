import { db, today } from '../db.js';
import { planOf } from '../plans.js';

/**
 * Собирает «пакет фактов» об аккаунте для AI-помощника админки.
 * Только чтение, только то, что нужно для диагностики: без паролей и токенов,
 * e-mail маскируется, IP остаются (они нужны для разбора блокировок).
 */

const maskEmail = (email) => {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return '—';
  const head = name.slice(0, 1) || '*';
  return `${head}${'*'.repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
};

const ISO = (v) => (v ? String(v).replace(' ', 'T') + 'Z' : null);

export function buildAiContext(userId) {
  const id = Number(userId);
  const user = db.prepare(
    `SELECT id, email, name, role, plan, status, created_at, last_login_at, blocked_at, blocked_reason,
            must_change_password, totp_enabled, premium_notice_at
     FROM users WHERE id=?`
  ).get(id);
  if (!user) return null;

  const plan = planOf(user);
  const activeSub = db.prepare(
    "SELECT plan, expires_at FROM subscriptions WHERE user_id=? AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1"
  ).get(id);
  const subs = db.prepare('SELECT plan, status, started_at, expires_at FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 3').all(id);

  const usage = db.prepare('SELECT codes_generated FROM usage_daily WHERE user_id=? AND day=?').get(id, today());
  const attempts = db.prepare('SELECT fails, locked_until, last_at FROM login_attempts WHERE email=?').get(user.email.toLowerCase()) || null;
  const locked = attempts?.locked_until
    ? Boolean(db.prepare("SELECT ? > datetime('now') AS l").get(attempts.locked_until).l)
    : false;

  const logins = db.prepare(
    'SELECT ok, reason, ip, user_agent, created_at FROM login_events WHERE user_id=? ORDER BY id DESC LIMIT 8'
  ).all(id);
  const sessions = db.prepare(
    "SELECT ip, user_agent, created_at, last_used_at FROM sessions WHERE user_id=? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 5"
  ).all(id);
  const ips = [...new Set(sessions.map((s) => s.ip).filter(Boolean))];
  const rateLimits = ips.length
    ? db.prepare(`SELECT key, count, window_start FROM rate_limits WHERE key IN (${ips.map(() => '?').join(',')})`)
      .all(...ips.map((ip) => 'ip:' + ip))
      .map((r) => ({ ip: String(r.key).replace(/^ip:/, ''), count: Number(r.count) || 0 }))
    : [];

  const jobs = db.prepare(
    'SELECT id, name, status, format, total, valid, done, error, created_at, finished_at FROM generation_jobs WHERE user_id=? ORDER BY id DESC LIMIT 5'
  ).all(id);
  const failedJobs24 = db.prepare(
    "SELECT COUNT(*) c FROM generation_jobs WHERE user_id=? AND status='error' AND created_at > datetime('now','-1 day')"
  ).get(id).c;

  const orders = db.prepare(
    'SELECT id, plan, amount, status, created_at, paid_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 4'
  ).all(id);
  const apiKeys = db.prepare('SELECT COUNT(*) c FROM api_keys WHERE user_id=?').get(id).c;

  const logs = db.prepare(
    "SELECT level, source, event, message, status, url, created_at FROM app_logs WHERE user_id=? ORDER BY id DESC LIMIT 8"
  ).all(id);
  const auditRows = db.prepare(
    "SELECT action, meta, ip, created_at FROM audit_log WHERE target_type='user' AND target_id=? ORDER BY id DESC LIMIT 6"
  ).all(String(id));

  const systemErrorsHour = db.prepare(
    "SELECT COUNT(*) c FROM app_logs WHERE level='error' AND source IN ('server','process') AND created_at > datetime('now','-1 hour')"
  ).get().c;
  const mailErrors = db.prepare(
    "SELECT message, created_at FROM app_logs WHERE source='mail' AND created_at > datetime('now','-7 days') ORDER BY id DESC LIMIT 20"
  ).all().filter((r) => String(r.message || '').includes(user.email));

  return {
    now: ISO(db.prepare("SELECT datetime('now') AS t").get().t),
    user: {
      id: user.id,
      email: maskEmail(user.email),
      name: user.name || '',
      role: user.role,
      plan: user.plan,
      status: user.status,
      createdAt: ISO(user.created_at),
      lastLoginAt: ISO(user.last_login_at),
      blockedAt: ISO(user.blocked_at),
      blockedReason: user.blocked_reason || '',
      mustChangePassword: Boolean(user.must_change_password),
      twoFactorEnabled: Boolean(user.totp_enabled)
    },
    planLimits: {
      id: plan.id,
      codesPerDay: plan.codesPerDay,
      batchMax: plan.batchMax,
      labelEditor: Boolean(plan.labelEditor),
      printBridge: Boolean(plan.printBridge),
      apiAccess: Boolean(plan.apiAccess),
      historyDays: plan.historyDays
    },
    subscription: activeSub || null,
    subscriptions: subs,
    usageToday: Number(usage?.codes_generated || 0),
    loginLock: { locked, fails: Number(attempts?.fails || 0), lockedUntil: locked ? attempts?.locked_until || null : null, lastFailAt: attempts?.last_at || null },
    loginEvents: logins,
    sessions,
    rateLimits,
    jobs: { recent: jobs, failedLast24h: Number(failedJobs24 || 0) },
    orders,
    apiKeysCount: Number(apiKeys || 0),
    appLogs: logs,
    mailErrors,
    adminActions: auditRows,
    system: { serverErrorsLastHour: Number(systemErrorsHour || 0) }
  };
}

/** Компактный текст-выжимка: экономит токены и облегчает модели чтение. */
export function formatAiContext(ctx) {
  if (!ctx) return 'Нет данных о пользователе.';
  const lines = [];
  const u = ctx.user;
  lines.push(`Пользователь #${u.id}: ${u.email} (${u.name || 'без имени'}), роль ${u.role}, тариф ${u.plan}, статус ${u.status}.`);
  lines.push(`Регистрация: ${u.createdAt}, последний вход: ${u.lastLoginAt || 'нет'}.`);
  if (u.blockedAt) lines.push(`Заблокирован: ${u.blockedAt}, причина: ${u.blockedReason || 'не указана'}.`);
  lines.push(`2FA: ${u.twoFactorEnabled ? 'включена' : 'выключена'}, требует смены пароля: ${u.mustChangePassword ? 'да' : 'нет'}.`);
  lines.push(`Лимиты тарифа: ${ctx.planLimits.codesPerDay} кодов/день, пакет до ${ctx.planLimits.batchMax}, редактор этикеток: ${ctx.planLimits.labelEditor ? 'да' : 'нет'}, Print Bridge: ${ctx.planLimits.printBridge ? 'да' : 'нет'}, API: ${ctx.planLimits.apiAccess ? 'да' : 'нет'}.`);
  lines.push(`Использовано сегодня: ${ctx.usageToday} кодов.`);
  if (ctx.subscription) lines.push(`Активная подписка: ${ctx.subscription.plan} до ${ctx.subscription.expires_at}.`);
  else lines.push('Активной подписки нет.');
  if (ctx.subscriptions?.length) lines.push(`Подписки (последние): ${ctx.subscriptions.map((s) => `${s.plan}/${s.status} до ${s.expires_at}`).join('; ')}.`);

  if (ctx.loginLock.locked || ctx.loginLock.fails) {
    lines.push(`Блокировка входа: ${ctx.loginLock.locked ? 'активна до ' + ctx.loginLock.lockedUntil : 'нет'}, неудачных попыток: ${ctx.loginLock.fails}, последняя: ${ctx.loginLock.lastFailAt || '—'}.`);
  }
  if (ctx.loginEvents.length) {
    lines.push('Последние входы: ' + ctx.loginEvents.map((l) => `${l.created_at} ${l.ok ? 'успех' : 'отказ'} (${l.reason || '—'}) IP ${l.ip || '—'}`).join('; '));
  }
  if (ctx.sessions.length) {
    lines.push('Активные сессии: ' + ctx.sessions.map((s) => `${s.created_at} IP ${s.ip || '—'} ${s.user_agent ? String(s.user_agent).slice(0, 40) : ''}`).join('; '));
  }
  if (ctx.rateLimits.length) {
    lines.push('Лимиты запросов по IP: ' + ctx.rateLimits.map((r) => `${r.ip}: ${r.count}`).join('; '));
  }
  if (ctx.jobs.recent.length) {
    lines.push('Последние задания: ' + ctx.jobs.recent.map((j) => `#${j.id} ${j.status} ${j.done}/${j.total} (${j.format || ''})${j.error ? ' ошибка: ' + String(j.error).slice(0, 80) : ''}`).join('; '));
  }
  if (ctx.jobs.failedLast24h) lines.push(`Ошибок заданий за сутки: ${ctx.jobs.failedLast24h}.`);
  if (ctx.orders.length) {
    lines.push('Платежи: ' + ctx.orders.map((o) => `#${o.id} ${o.plan} ${o.amount}₽ ${o.status} ${o.created_at}`).join('; '));
  }
  lines.push(`API-ключей: ${ctx.apiKeysCount}.`);
  if (ctx.appLogs.length) {
    lines.push('Ошибки из журнала: ' + ctx.appLogs.map((l) => `${l.created_at} ${l.level}/${l.source} ${l.event || ''} ${String(l.message || '').slice(0, 120)}`).join(' | '));
  }
  if (ctx.mailErrors.length) {
    lines.push('Ошибки почты для этого адреса: ' + ctx.mailErrors.map((m) => String(m.message).slice(0, 120)).join(' | '));
  }
  if (ctx.adminActions.length) {
    lines.push('Действия админов: ' + ctx.adminActions.map((a) => `${a.created_at} ${a.action}`).join('; '));
  }
  lines.push(`Система: серверных ошибок за час: ${ctx.system.serverErrorsLastHour}.`);
  return lines.join('\n');
}
