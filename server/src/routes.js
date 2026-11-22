import { randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { db, usageToday } from './db.js';
import { recordConversion } from './lib/analytics.js';
import { hashPassword, verifyPassword, createSession, sessionUser, destroySession, publicUser, publicWorkspace, workspaceFor, sessionDaysFor } from './auth.js';
import { PLANS, planOf, publicPlans, listPlans } from './plans.js';
import { entitlements } from './lib/subscription.js';
import { notifyRegistration } from './notify.js';
import { issueTicket } from './lib/twofa-ticket.js';
import { sendMail, smtpConfigured } from './lib/mailer.js';
import { renderBrandEmail } from './lib/email-template.js';
import { publicUrl } from './lib/public-url.js';
import { logLogin } from './lib/auth-events.js';
import { VIEW_COOKIE, getViewSession, destroyViewSession } from './lib/view-session.js';

const EMAIL_RE = /^[^\s@<>(),;:"\\\[\]]{1,64}@[^\s@<>(),;:"\\\[\]]{1,255}\.[^\s@<>(),;:"\\\[\]]{1,63}$/;
const attempts = new Map(); // ip -> { n, reset }

function rateLimit(ip, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now > a.reset) { attempts.set(ip, { n: 1, reset: now + windowMs }); return true; }
  a.n++;
  return a.n <= max;
}

setInterval(() => { const t = Date.now(); for (const [k, v] of attempts) if (t > v.reset) attempts.delete(k); }, 60_000).unref();

const COOKIE = 'cq_session';
const RESET_SECRET = process.env.PASSWORD_RESET_SECRET || process.env.APP_SECRET || 'code-qr-pro-password-reset';
const resetCodeHash = (userId, code) => createHash('sha256').update(`${userId}:${code}:${RESET_SECRET}`).digest('hex');

function lockStatus(email) {
  const row = db.prepare('SELECT locked_until FROM login_attempts WHERE email=?').get(email);
  if (!row?.locked_until) return false;
  return Boolean(db.prepare("SELECT ? > datetime('now') AS locked").get(row.locked_until).locked);
}

function recordLoginFail(email) {
  const now = db.prepare("SELECT datetime('now') t").get().t;
  const row = db.prepare('SELECT * FROM login_attempts WHERE email=?').get(email);
  if (!row) {
    db.prepare('INSERT INTO login_attempts (email, fails, window_start, last_at) VALUES (?,1,?,?)').run(email, now, now);
    return false;
  }
  const expired = db.prepare("SELECT ? <= datetime('now','-15 minutes') AS expired").get(row.window_start).expired;
  if (expired) {
    db.prepare('UPDATE login_attempts SET fails=1, window_start=?, locked_until=NULL, last_at=? WHERE email=?').run(now, now, email);
    return false;
  }
  const fails = row.fails + 1;
  if (fails >= 5) {
    db.prepare("UPDATE login_attempts SET fails=?, locked_until=datetime('now','+15 minutes'), last_at=? WHERE email=?").run(fails, now, email);
    return !row.locked_until;
  }
  db.prepare('UPDATE login_attempts SET fails=?, last_at=? WHERE email=?').run(fails, now, email);
  return false;
}

function clearLoginFails(email) {
  db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
}

// Простая страница для ошибок одноразовой ссылки входа.
function linkPage(title, text) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — CODE QR PRO</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070b18;color:#e2e8f0;font-family:-apple-system,Arial,sans-serif">
<div style="max-width:420px;padding:32px 24px;text-align:center">
<h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1>
<p style="color:#94a3b8;line-height:1.5;margin:0 0 20px">${esc(text)}</p>
<a href="/login" style="display:inline-block;padding:10px 18px;border-radius:12px;background:#3b82f6;color:#fff;text-decoration:none">Перейти ко входу</a>
</div></body></html>`;
}

function notifyLoginBlocked(user, ip) {
  if (!user || !smtpConfigured()) return;
  const safeIp = String(ip || '').replace(/[<>&]/g, '');
  const { html, text } = renderBrandEmail({
    title: 'Подозрительная активность',
    badge: 'Безопасность',
    preheader: 'Зафиксировано 5 неудачных попыток входа',
    intro: 'Зафиксировано 5 неудачных попыток входа в аккаунт CODE QR PRO.\nВход временно заблокирован на 15 минут.',
    notice: `IP: ${safeIp}\nЕсли это были не вы — смените пароль после разблокировки.`,
    noticeTone: 'warn',
    ctaLabel: 'Открыть безопасность',
    ctaUrl: `${publicUrl()}/app/security`
  });
  sendMail({
    to: user.email,
    subject: 'Подозрительная активность — CODE QR PRO',
    text,
    html
  }).catch(() => {});
}
// Пока стоит флаг must_change_password, работать можно только с этими маршрутами
const PASSWORD_EXEMPT = new Set(['/api/auth/password', '/api/auth/logout', '/api/me']);

export const requireAuth = async (req, reply) => {
  let user = null;
  let impersonatedBy = null;
  // Режим просмотра «как клиент» имеет приоритет: пока открыта вкладка просмотра,
  // запросы идут от лица клиента и только на чтение.
  const view = getViewSession(req.cookies?.[VIEW_COOKIE]);
  if (view) {
    if (!['GET', 'HEAD'].includes(req.method)) {
      return reply.code(403).send({ error: 'Режим просмотра: только чтение', code: 'readonly' });
    }
    user = db.prepare(
      `SELECT id, email, name, role, plan, status, must_change_password, totp_enabled, created_at
       FROM users WHERE id=?`
    ).get(view.user_id);
    if (user) impersonatedBy = view.admin_id;
  }
  if (!user) user = sessionUser(req.cookies[COOKIE]);
  if (!user) return reply.code(401).send({ error: 'Не авторизован' });
  if (user.status === 'blocked') {
    return reply.code(403).send({ error: 'Аккаунт заблокирован. Напишите в поддержку.' });
  }
  const path = String(req.url || '').split('?')[0];
  if (user.teamMemberId && !user.teamMemberUserId) {
    const personal = ['/api/auth/password', '/api/auth/2fa'];
    if (personal.some((prefix) => path === prefix || path.startsWith(prefix + '/'))) {
      return reply.code(403).send({ error: 'Сначала активируйте личный вход по новому приглашению', code: 'team_account_required' });
    }
  }
  if (user.teamMemberId && user.teamMemberRole === 'viewer' && !['GET', 'HEAD'].includes(req.method)) {
    return reply.code(403).send({ error: 'Роль «Просмотр»: только чтение', code: 'team_viewer_readonly' });
  }
  if (user.teamMemberId) {
    const blocked = ['/api/billing', '/api/team', '/api/admin', '/api/keys', '/api/settings'];
    if (blocked.some((prefix) => path === prefix || path.startsWith(prefix + '/'))) {
      return reply.code(403).send({ error: 'Доступно только владельцу аккаунта', code: 'team_member_forbidden' });
    }
  }
  if (!impersonatedBy && user.must_change_password && !PASSWORD_EXEMPT.has(path)) {
    return reply.code(428).send({ error: 'Сначала смените временный пароль', code: 'password_change_required' });
  }
  req.user = impersonatedBy ? { ...user, impersonatedBy } : user;
};

export async function registerRoutes(app) {
  const cookieOpts = (expires) => ({
    path: '/', httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires
  });

  app.post('/api/auth/register', async (req, reply) => {
    if (!rateLimit("register:" + req.ip)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const { email, password, name, consent, consentVersion, acquisition } = req.body || {};
    if (consent !== true) {
      return reply.code(400).send({ error: 'Подтвердите принятие Пользовательского соглашения, Публичной оферты и согласие на обработку персональных данных' });
    }
    if (!email || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'Некорректный email' });
    if (!password || typeof password !== 'string' || password.length < 8) return reply.code(400).send({ error: 'Пароль минимум 8 символов' });
    if (password.length > 200) return reply.code(400).send({ error: 'Пароль слишком длинный' });
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (exists) return reply.code(409).send({ error: 'Email уже зарегистрирован' });
    const acq = acquisition && typeof acquisition === 'object' ? acquisition : {};
    const acqText = (v, max) => String(v || '').trim().toLowerCase().slice(0, max);
    const info = db.prepare('INSERT INTO users (email, password_hash, name, consent_at, consent_version, acq_source, acq_medium, acq_campaign, acq_landing) VALUES (?, ?, ?, datetime(\'now\'), ?, ?, ?, ?, ?)')
      .run(email.toLowerCase(), hashPassword(password), (name || '').slice(0, 100), String(consentVersion || '2026-11-21').slice(0, 40),
        acqText(acq.source, 80) || 'direct', acqText(acq.medium, 80) || 'none', acqText(acq.campaign, 120), String(acq.landing || '').slice(0, 200));
    if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 1) {
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(info.lastInsertRowid);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    recordConversion('registration', user.id);
    const { token, expires } = createSession(user.id, {
      ip: req.ip, ua: req.headers['user-agent'], days: sessionDaysFor(user.role)
    });
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    db.prepare('DELETE FROM login_attempts WHERE email=?').run(email.toLowerCase());
    const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    notifyRegistration(user, totalUsers);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (!rateLimit("login:" + req.ip)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail) return reply.code(401).send({ error: 'Неверный email или пароль' });
    if (lockStatus(normalizedEmail)) {
      logLogin({ email: normalizedEmail, ok: false, reason: 'locked', ip: req.ip, ua: req.headers['user-agent'] });
      return reply.code(429).send({ error: 'Слишком много неудачных попыток. Вход заблокирован на 15 минут.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    const passwordInput = typeof password === 'string' ? password : '';
    if (!user || !passwordInput || passwordInput.length > 200 || !verifyPassword(passwordInput, user.password_hash)) {
      const justLocked = recordLoginFail(normalizedEmail);
      if (justLocked) notifyLoginBlocked(user, req.ip);
      logLogin({ userId: user?.id ?? null, email: normalizedEmail, ok: false, reason: 'bad_password', ip: req.ip, ua: req.headers['user-agent'] });
      return reply.code(401).send({ error: 'Неверный email или пароль' });
    }
    if (user.status === 'blocked') {
      logLogin({ userId: user.id, email: normalizedEmail, ok: false, reason: 'blocked', ip: req.ip, ua: req.headers['user-agent'] });
      return reply.code(403).send({ error: 'Аккаунт заблокирован. Напишите в поддержку.' });
    }
    clearLoginFails(normalizedEmail);
    const workspace = user.owner_id ? workspaceFor(user) : null;
    if (user.owner_id && !workspace) {
      logLogin({ userId: user.id, email: normalizedEmail, ok: false, reason: 'team_revoked', ip: req.ip, ua: req.headers['user-agent'] });
      return reply.code(403).send({ error: 'Доступ к аккаунту команды отозван. Обратитесь к владельцу.' });
    }
    if (user.totp_enabled) {
      return { twoFactor: true, ticket: issueTicket(user.id), email: user.email };
    }
    db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(user.id);
    const loginOwnerId = workspace ? workspace.owner.id : user.id;
    const { token, expires } = createSession(loginOwnerId, { ip: req.ip, ua: req.headers['user-agent'], days: sessionDaysFor(workspace ? workspace.owner.role : user.role), teamMemberId: workspace?.member.id });
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    logLogin({ userId: user.id, email: normalizedEmail, ok: true, reason: workspace ? 'team_password' : 'password', ip: req.ip, ua: req.headers['user-agent'] });
    return { user: workspace ? publicWorkspace(workspace.owner, workspace.member) : publicUser(user) };
  });

  // Одноразовая ссылка входа, которую выдаёт админ для быстрой помощи клиенту.
  // Ссылка действует 15 минут и позволяет войти без пароля (2FA тоже обходится —
  // поэтому выдаётся только администратором и попадает в журнал аудита).
  app.get('/api/auth/link/:token', async (req, reply) => {
    const token = String(req.params?.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return reply.code(400).type('text/html; charset=utf-8')
      .send(linkPage('Ссылка недействительна', 'Попросите администратора выдать новую ссылку.'));
    const hash = createHash('sha256').update(token).digest('hex');
    const row = db.prepare(`
      SELECT l.id, l.user_id, l.expires_at, u.status, u.email
      FROM login_links l JOIN users u ON u.id = l.user_id
      WHERE l.token_hash = ?
    `).get(hash);
    if (!row) return reply.code(404).type('text/html; charset=utf-8')
      .send(linkPage('Ссылка недействительна', 'Попросите администратора выдать новую ссылку.'));
    const expired = db.prepare("SELECT ? <= datetime('now') AS e").get(row.expires_at).e;
    if (expired) return reply.code(410).type('text/html; charset=utf-8')
      .send(linkPage('Срок ссылки истёк', 'Ссылка действует 15 минут. Попросите администратора выдать новую.'));
    if (row.status === 'blocked') return reply.code(403).type('text/html; charset=utf-8')
      .send(linkPage('Аккаунт заблокирован', 'Обратитесь в поддержку.'));
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
    if (!user) return reply.code(404).type('text/html; charset=utf-8')
      .send(linkPage('Пользователь не найден', 'Обратитесь в поддержку.'));
    db.prepare("UPDATE login_links SET used_at=coalesce(used_at, datetime('now')) WHERE id=?").run(row.id);
    clearLoginFails(user.email.toLowerCase());
    db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(user.id);
    const { token: sessionToken, expires } = createSession(user.id, {
      ip: req.ip, ua: req.headers['user-agent'], days: sessionDaysFor(user.role)
    });
    reply.setCookie(COOKIE, sessionToken, cookieOpts(new Date(expires)));
    logLogin({ userId: user.id, email: user.email, ok: true, reason: 'admin_link', ip: req.ip, ua: req.headers['user-agent'] });
    return reply.redirect('/app', 302);
  });

  // Вход в режим просмотра «как клиент» по одноразовой ссылке от админа.
  app.get('/api/admin/view/:token', async (req, reply) => {
    const token = String(req.params?.token || '');
    const view = getViewSession(token);
    if (!view) return reply.code(410).type('text/html; charset=utf-8')
      .send(linkPage('Ссылка просмотра истекла', 'Попросите администратора открыть просмотр заново.'));
    reply.setCookie(VIEW_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      expires: new Date(Date.now() + 30 * 60 * 1000)
    });
    return reply.redirect('/app', 302);
  });

  app.post('/api/auth/forgot', async (req, reply) => {    if (!rateLimit("forgot:" + req.ip, 5, 60_000)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'Некорректный email' });
    if (!smtpConfigured()) return reply.code(503).send({ error: 'Отправка почты не настроена. Обратитесь в поддержку.' });

    const generic = { ok: true, message: 'Если такой email зарегистрирован, мы отправили код. Проверьте почту и папку «Спам».' };
    const user = db.prepare('SELECT id, email, status FROM users WHERE email=?').get(email);
    if (!user || user.status === 'blocked') return generic;

    const recent = db.prepare("SELECT COUNT(*) c FROM password_resets WHERE user_id=? AND created_at > datetime('now','-1 hour')").get(user.id).c;
    if (recent >= 5) return generic;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expires = db.prepare("SELECT datetime('now','+15 minutes') t").get().t;
    db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL").run(user.id);
    db.prepare('INSERT INTO password_resets (user_id, code_hash, expires_at, ip) VALUES (?,?,?,?)')
      .run(user.id, resetCodeHash(user.id, code), expires, String(req.ip || '').slice(0, 60));

    try {
      const brand = renderBrandEmail({
        title: 'Восстановление пароля',
        badge: 'Код доступа',
        preheader: `Код для смены пароля: ${code}`,
        intro: 'Здравствуйте!\n\nВы запросили восстановление пароля в CODE QR PRO. Введите код на странице восстановления:',
        code,
        notice: 'Код действует 15 минут. Если вы не запрашивали восстановление — просто проигнорируйте письмо, пароль останется прежним.',
        noticeTone: 'warn',
        ctaLabel: 'Ввести код',
        ctaUrl: `${publicUrl()}/login?reset=1`
      });
      await sendMail({
        to: user.email,
        subject: 'Восстановление пароля CODE QR PRO',
        text: brand.text,
        html: brand.html
      });
    } catch (e) {
      console.error('password reset email failed:', e?.message || e);
      return reply.code(502).send({ error: 'Не удалось отправить письмо. Попробуйте позже.' });
    }
    return generic;
  });

  app.post('/api/auth/reset', async (req, reply) => {
    if (!rateLimit("reset:" + req.ip, 10, 60_000)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const password = req.body?.password;
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return reply.code(400).send({ error: 'Неверный код или email, либо код истёк. Запросите новый код' });
    if (typeof password !== 'string' || password.length < 8) return reply.code(400).send({ error: 'Новый пароль минимум 8 символов' });
    if (password.length > 200) return reply.code(400).send({ error: 'Пароль слишком длинный' });

    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) return reply.code(400).send({ error: 'Неверный код или email, либо код истёк. Запросите новый код' });
    const row = db.prepare("SELECT * FROM password_resets WHERE user_id=? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1").get(user.id);
    if (!row || row.attempts >= 5) return reply.code(400).send({ error: 'Неверный код или email, либо код истёк. Запросите новый код' });

    const hash = resetCodeHash(user.id, code);
    const ok = row.code_hash.length === hash.length && timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hash));
    if (!ok) {
      db.prepare('UPDATE password_resets SET attempts=attempts+1 WHERE id=?').run(row.id);
      return reply.code(400).send({ error: 'Неверный код или email, либо код истёк. Запросите новый код' });
    }

    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(password), user.id);
      db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE id=?").run(row.id);
      db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL").run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM sessions WHERE team_member_id IN (SELECT id FROM team_members WHERE user_id=?)').run(user.id);
      db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
    })();
    return { ok: true };
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body || {};
    const accountId = req.user.teamMemberUserId || req.user.id;
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(accountId);
    if (!currentPassword || !row || !verifyPassword(String(currentPassword), row.password_hash)) {
      return reply.code(400).send({ error: 'Текущий пароль указан неверно' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return reply.code(400).send({ error: 'Новый пароль минимум 8 символов' });
    }
    if (newPassword.length > 200) return reply.code(400).send({ error: 'Пароль слишком длинный' });
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?')
      .run(hashPassword(newPassword), accountId);
    if (req.user.teamMemberId) {
      db.prepare('DELETE FROM sessions WHERE user_id=? AND team_member_id=? AND token<>?')
        .run(req.user.id, req.user.teamMemberId, req.cookies[COOKIE] || '');
    } else {
      db.prepare('DELETE FROM sessions WHERE user_id=? AND team_member_id IS NULL AND token<>?')
        .run(req.user.id, req.cookies[COOKIE] || '');
    }
    db.prepare('DELETE FROM login_attempts WHERE email=?').run(req.user.teamMemberEmail || req.user.email);
    return { ok: true };
  });

  // Выход из режима просмотра: админская сессия остаётся.
  app.post('/api/auth/view/exit', async (req, reply) => {
    destroyViewSession(req.cookies?.[VIEW_COOKIE]);
    reply.clearCookie(VIEW_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req.cookies[COOKIE]);
    destroyViewSession(req.cookies?.[VIEW_COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    reply.clearCookie(VIEW_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/sessions', { preHandler: requireAuth }, async (req) => {
    const current = req.cookies[COOKIE] || '';
    const rows = req.user.teamMemberId
      ? db.prepare(
        `SELECT ip, user_agent, created_at, last_used_at, expires_at, (token = ?) AS current
         FROM sessions WHERE user_id=? AND team_member_id=? ORDER BY created_at DESC LIMIT 50`
      ).all(current, req.user.id, req.user.teamMemberId)
      : db.prepare(
        `SELECT ip, user_agent, created_at, last_used_at, expires_at, (token = ?) AS current
         FROM sessions WHERE user_id=? AND team_member_id IS NULL ORDER BY created_at DESC LIMIT 50`
      ).all(current, req.user.id);
    return { sessions: rows.map((r) => ({ ...r, current: Boolean(r.current) })) };
  });

  app.post('/api/auth/sessions/logout-all', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.teamMemberId) db.prepare('DELETE FROM sessions WHERE user_id=? AND team_member_id=?').run(req.user.id, req.user.teamMemberId);
    else db.prepare('DELETE FROM sessions WHERE user_id=? AND team_member_id IS NULL').run(req.user.id);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const data = entitlements(req.user);
    return {
      user: publicUser(req.user),
      plan: data.plan,
      subscription: data.usage.subscription,
      trial: data.plan.trial,
      impersonated: Boolean(req.user.impersonatedBy),
      impersonatedBy: req.user.impersonatedBy || null,
      usage: {
        ...data.usage,
        codesToday: usageToday(req.user.id),
        codesPerDay: data.plan.codesPerDay
      }
    };
  });

  app.get('/api/plans', async () => ({
    plans: Object.values(publicPlans()),
    list: listPlans({ activeOnly: true })
  }));

  app.get('/api/health', async (req, reply) => {
    try {
      db.prepare('SELECT 1').get();
    } catch {
      return reply.code(503).send({ ok: false, service: 'code-qr-pro', db: 'error' });
    }
    return { ok: true, service: 'code-qr-pro', stage: 5, db: 'ok', uptime: Math.round(process.uptime()) };
  });
}
