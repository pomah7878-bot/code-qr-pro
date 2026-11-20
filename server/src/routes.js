import { randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { db, usageToday } from './db.js';
import { hashPassword, verifyPassword, createSession, sessionUser, destroySession, publicUser, sessionDaysFor } from './auth.js';
import { PLANS, planOf, publicPlans } from './plans.js';
import { notifyRegistration } from './notify.js';
import { issueTicket } from './lib/twofa-ticket.js';
import { sendMail, smtpConfigured } from './lib/mailer.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const attempts = new Map(); // ip -> { n, reset }

function rateLimit(ip, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now > a.reset) { attempts.set(ip, { n: 1, reset: now + windowMs }); return true; }
  a.n++;
  return a.n <= max;
}

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
  sendMail({
    to: user.email,
    subject: 'Подозрительная активность — CODE QR PRO',
    text: `Зафиксировано 5 неудачных попыток входа в аккаунт CODE QR PRO.\nВход временно заблокирован на 15 минут.\nIP: ${ip}\n\nЕсли это были не вы — смените пароль после разблокировки.`,
    html: `<p>Зафиксировано 5 неудачных попыток входа в аккаунт <b>CODE QR PRO</b>.</p>
      <p>Вход временно заблокирован на <b>15 минут</b>.</p>
      <p>IP: <b>${String(ip || '').replace(/[<>&]/g, '')}</b></p>
      <p>Если это были не вы — смените пароль после разблокировки.</p>`
  }).catch(() => {});
}
// Пока стоит флаг must_change_password, работать можно только с этими маршрутами
const PASSWORD_EXEMPT = new Set(['/api/auth/password', '/api/auth/logout', '/api/me']);

export const requireAuth = async (req, reply) => {
  const user = sessionUser(req.cookies[COOKIE]);
  if (!user) return reply.code(401).send({ error: 'Не авторизован' });
  if (user.status === 'blocked') {
    return reply.code(403).send({ error: 'Аккаунт заблокирован. Напишите в поддержку.' });
  }
  const path = String(req.url || '').split('?')[0];
  if (user.must_change_password && !PASSWORD_EXEMPT.has(path)) {
    return reply.code(428).send({ error: 'Сначала смените временный пароль', code: 'password_change_required' });
  }
  req.user = user;
};

export async function registerRoutes(app) {
  const cookieOpts = (expires) => ({
    path: '/', httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires
  });

  app.post('/api/auth/register', async (req, reply) => {
    if (!rateLimit(req.ip)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const { email, password, name } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'Некорректный email' });
    if (!password || typeof password !== 'string' || password.length < 8) return reply.code(400).send({ error: 'Пароль минимум 8 символов' });
    if (password.length > 200) return reply.code(400).send({ error: 'Пароль слишком длинный' });
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (exists) return reply.code(409).send({ error: 'Email уже зарегистрирован' });
    const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(email.toLowerCase(), hashPassword(password), (name || '').slice(0, 100));
    if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 1) {
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(info.lastInsertRowid);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
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
    if (!rateLimit(req.ip)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail) return reply.code(401).send({ error: 'Неверный email или пароль' });
    if (lockStatus(normalizedEmail)) {
      return reply.code(429).send({ error: 'Слишком много неудачных попыток. Вход заблокирован на 15 минут.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    const passwordInput = typeof password === 'string' ? password : '';
    if (!user || !passwordInput || passwordInput.length > 200 || !verifyPassword(passwordInput, user.password_hash)) {
      const justLocked = recordLoginFail(normalizedEmail);
      if (justLocked) notifyLoginBlocked(user, req.ip);
      return reply.code(401).send({ error: 'Неверный email или пароль' });
    }
    if (user.status === 'blocked') {
      return reply.code(403).send({ error: 'Аккаунт заблокирован. Напишите в поддержку.' });
    }
    clearLoginFails(normalizedEmail);
    if (user.totp_enabled) {
      return { twoFactor: true, ticket: issueTicket(user.id), email: user.email };
    }
    db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(user.id);
    const { token, expires } = createSession(user.id, { ip: req.ip, ua: req.headers['user-agent'], days: sessionDaysFor(user.role) });
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    return { user: publicUser(user) };
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
    return reply.redirect('/app', 302);
  });

  app.post('/api/auth/forgot', async (req, reply) => {    if (!rateLimit(req.ip, 5, 60_000)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
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
      await sendMail({
        to: user.email,
        subject: 'Восстановление пароля CODE QR PRO',
        text: `Здравствуйте!\n\nКод для восстановления пароля: ${code}\nКод действует 15 минут.\n\nЕсли вы не запрашивали восстановление — просто проигнорируйте это письмо.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
          <h2 style="margin:0 0 12px">Восстановление пароля</h2>
          <p>Код для смены пароля:</p>
          <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
          <p>Код действует <b>15 минут</b>.</p>
          <p style="color:#64748b;font-size:13px">Если вы не запрашивали восстановление — просто проигнорируйте это письмо.</p>
        </div>`
      });
    } catch (e) {
      console.error('password reset email failed:', e?.message || e);
      return reply.code(502).send({ error: 'Не удалось отправить письмо. Попробуйте позже.' });
    }
    return generic;
  });

  app.post('/api/auth/reset', async (req, reply) => {
    if (!rateLimit(req.ip, 10, 60_000)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const password = req.body?.password;
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return reply.code(400).send({ error: 'Неверный код или email' });
    if (typeof password !== 'string' || password.length < 8) return reply.code(400).send({ error: 'Новый пароль минимум 8 символов' });
    if (password.length > 200) return reply.code(400).send({ error: 'Пароль слишком длинный' });

    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) return reply.code(400).send({ error: 'Неверный код или email' });
    const row = db.prepare("SELECT * FROM password_resets WHERE user_id=? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1").get(user.id);
    if (!row || row.attempts >= 5) return reply.code(400).send({ error: 'Код истёк или неверен. Запросите новый.' });

    const hash = resetCodeHash(user.id, code);
    const ok = row.code_hash.length === hash.length && timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hash));
    if (!ok) {
      db.prepare('UPDATE password_resets SET attempts=attempts+1 WHERE id=?').run(row.id);
      return reply.code(400).send({ error: 'Неверный код или email' });
    }

    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(password), user.id);
      db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE id=?").run(row.id);
      db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL").run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
    })();
    return { ok: true };
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
    if (!currentPassword || !row || !verifyPassword(String(currentPassword), row.password_hash)) {
      return reply.code(400).send({ error: 'Текущий пароль указан неверно' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return reply.code(400).send({ error: 'Новый пароль минимум 8 символов' });
    }
    if (newPassword.length > 200) return reply.code(400).send({ error: 'Пароль слишком длинный' });
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?')
      .run(hashPassword(newPassword), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id, req.cookies[COOKIE] || '');
    db.prepare('DELETE FROM login_attempts WHERE email=?').run(req.user.email);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/sessions', { preHandler: requireAuth }, async (req) => {
    const current = req.cookies[COOKIE] || '';
    const rows = db.prepare(
      `SELECT ip, user_agent, created_at, last_used_at, expires_at, (token = ?) AS current
       FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 50`
    ).all(current, req.user.id);
    return { sessions: rows.map((r) => ({ ...r, current: Boolean(r.current) })) };
  });

  app.post('/api/auth/sessions/logout-all', { preHandler: requireAuth }, async (req, reply) => {
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const plan = planOf(req.user);
    return {
      user: publicUser(req.user),
      plan,
      usage: { codesToday: usageToday(req.user.id), codesPerDay: plan.codesPerDay }
    };
  });

  app.get('/api/plans', async () => ({ plans: Object.values(publicPlans()) }));

  app.get('/api/health', async (req, reply) => {
    try {
      db.prepare('SELECT 1').get();
    } catch {
      return reply.code(503).send({ ok: false, service: 'code-qr-pro', db: 'error' });
    }
    return { ok: true, service: 'code-qr-pro', stage: 5, db: 'ok', uptime: Math.round(process.uptime()) };
  });
}
