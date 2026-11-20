import { db } from './db.js';
import { isAllowlisted } from './lib/allowlist.js';

// Постоянный rate-limit по IP (переживает рестарт и работает при нескольких процессах)
export function rateLimitHook(max = 300, windowMs = 60000) {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  return async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (isAllowlisted(req.ip)) return;
    const now = Math.floor(Date.now() / 1000);
    const key = `ip:${req.ip}`;
    try {
      db.prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
           window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END`
      ).run(key, now, now - windowSec, now - windowSec, now);
      const row = db.prepare('SELECT count FROM rate_limits WHERE key=?').get(key);
      if (row && row.count > max) return reply.code(429).send({ error: 'Слишком много запросов, подождите минуту' });
    } catch {
      // при сбое БД не блокируем весь сервис
    }
  };
}

setInterval(() => {
  try { db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(Math.floor(Date.now() / 1000) - 3600); }
  catch { /* ignore */ }
}, 60000).unref();

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://mobile.api.crpt.ru",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

export async function securityHeaders(req, reply) {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  reply.header('Content-Security-Policy', CSP);
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Embedder-Policy', 'credentialless');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('X-Permitted-Cross-Domain-Policies', 'none');
  // настройки из админки должны быть видны сразу, без кеша браузера
  if (String(req.url || '').startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  if (process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// CSRF: изменяющие запросы с cookie должны приходить с того же хоста.
// Запросы без cookie (API-ключи, вебхуки, серверные интеграции) не блокируем.
export async function sameOriginGuard(req, reply) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const hasSessionCookie = /(?:^|;\s*)cq_session=/.test(String(req.headers.cookie || ''));
  if (!hasSessionCookie) return;
  const origin = req.headers.origin;
  if (!origin) return reply.code(403).send({ error: 'Запрос без Origin отклонён' });
  let host;
  try { host = new URL(origin).host; } catch { return reply.code(403).send({ error: 'Некорректный Origin' }); }
  const target = req.headers['x-forwarded-host'] || req.headers.host;
  if (host !== target) return reply.code(403).send({ error: 'Запрос с чужого источника отклонён' });
}

export const isRowIndex = (v) => /^\d{1,6}$/.test(String(v));
