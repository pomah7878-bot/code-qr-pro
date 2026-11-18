import { db, usageToday } from './db.js';
import { hashPassword, verifyPassword, createSession, sessionUser, destroySession, publicUser } from './auth.js';
import { PLANS, planOf } from './plans.js';

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

export const requireAuth = async (req, reply) => {
  const user = sessionUser(req.cookies[COOKIE]);
  if (!user) return reply.code(401).send({ error: 'Не авторизован' });
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
    const { token, expires } = createSession(info.lastInsertRowid);
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (!rateLimit(req.ip)) return reply.code(429).send({ error: 'Слишком много попыток, подождите минуту' });
    const { email, password } = req.body || {};
    const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase()) : null;
    if (!user || !password || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'Неверный email или пароль' });
    }
    const { token, expires } = createSession(user.id);
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    return { user: publicUser(user) };
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

  app.get('/api/plans', async () => ({ plans: Object.values(PLANS) }));

  app.get('/api/health', async () => ({ ok: true, service: 'code-qr-pro', stage: 3 }));
}
