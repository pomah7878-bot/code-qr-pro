// Глобальный rate-limit по IP и security-заголовки
const hits = new Map();

export function rateLimitHook(max = 300, windowMs = 60000) {
  return async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || now > h.reset) { h = { n: 0, reset: now + windowMs }; hits.set(req.ip, h); }
    h.n++;
    if (h.n > max) return reply.code(429).send({ error: 'Слишком много запросов, подождите минуту' });
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 60000).unref();

export async function securityHeaders(req, reply) {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// Простая защита от CSRF: изменяющие запросы из браузера должны приходить с того же хоста
export async function sameOriginGuard(req, reply) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return; // curl, 1С, серверные интеграции
  let host;
  try { host = new URL(origin).host; } catch { return reply.code(403).send({ error: 'Некорректный Origin' }); }
  const target = req.headers['x-forwarded-host'] || req.headers.host;
  if (host !== target) return reply.code(403).send({ error: 'Запрос с чужого источника отклонён' });
}

export const isRowIndex = (v) => /^\d{1,6}$/.test(String(v));
