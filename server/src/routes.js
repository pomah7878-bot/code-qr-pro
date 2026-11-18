import { db, usageToday } from './db.js';
import { hashPassword, verifyPassword, createSession, sessionUser, destroySession, publicUser } from './auth.js';
import { PLANS, planOf, publicPlans } from './plans.js';
import { notifyRegistration } from './notify.js';
import { issueTicket } from './lib/twofa-ticket.js';

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
    if (!password || password.length < 8) return reply.code(400).send({ error: 'Пароль минимум 8 символов' });
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (exists) return reply.code(409).send({ error: 'Email уже зарегистрирован' });
    const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(email.toLowerCase(), hashPassword(password), (name || '').slice(0, 100));
    if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 1) {
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(info.lastInsertRowid);
    }
    const { token, expires } = createSession(info.lastInsertRowid, { ip: req.ip, ua: req.headers['user-agent'] });
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    notifyRegistration(user, totalUsers);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (!rateLimit(req.ip)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const { email, password } = req.body || {};
    const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase()) : null;
    if (!user || !password || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'Неверный email или пароль' });
    }
    if (user.status === 'blocked') {
      return reply.code(403).send({ error: 'Аккаунт заблокирован. Напишите в поддержку.' });
    }
    if (user.totp_enabled) {
      return { twoFactor: true, ticket: issueTicket(user.id), email: user.email };
    }
    db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(user.id);
    const { token, expires } = createSession(user.id, { ip: req.ip, ua: req.headers['user-agent'] });
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    return { user: publicUser(user) };
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
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req.cookies[COOKIE]);
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

  app.get('/api/health', async () => ({ ok: true, service: 'code-qr-pro', stage: 5 }));
}
