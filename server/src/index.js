import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import dns from 'node:dns';
import { existsSync, readFileSync, statSync } from 'node:fs';

// У VPS нет рабочего IPv6, а DNS отдаёт AAAA первым: Node ходил по IPv6 и падал
// (например, уведомления в Telegram). Принудительно используем IPv4.
dns.setDefaultResultOrder('ipv4first');
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';
import { registerTeamRoutes } from './routes-team.js';
import { registerPublicCheckRoutes } from './routes-public-check.js';
import { registerJobRoutes } from './routes-jobs.js';
import { registerLabelRoutes } from './routes-labels.js';
import { registerBillingRoutes } from './routes-billing.js';
import { registerAdminRoutes } from './routes-admin.js';
import { registerAdminBankRoutes } from './routes-admin-bank.js';
import { registerAdminSystemRoutes } from './routes-admin-system.js';
import { registerAdminUserRoutes } from './routes-admin-users.js';
import { registerAdminOrderRoutes } from './routes-admin-orders.js';
import { registerAdminAnalyticsRoutes } from './routes-admin-analytics.js';
import { registerTwoFactorRoutes } from './routes-2fa.js';
import { registerAdminAuditRoutes } from './routes-admin-audit.js';
import { registerAdminPromoRoutes } from './routes-admin-promo.js';
import { registerAdminMailRoutes } from './routes-admin-mail.js';
import { registerAdminStorageRoutes } from './routes-admin-storage.js';
import { registerApiRoutes } from './routes-api.js';
import { registerReviewRoutes } from './routes-reviews.js';
import { registerSetRoutes } from './routes-sets.js';
import { registerAdRoutes } from './routes-ads.js';
import { registerAdminSecurityRoutes } from './routes-admin-security.js';
import { registerAdminAiRoutes } from './routes-admin-ai.js';
import { registerAdminBillingRoutes } from './routes-admin-billing.js';
import { registerAiSupportRoutes } from './routes-ai-support.js';
import { registerAnalyticsRoutes } from './routes-analytics.js';
import { registerAdminSeoRoutes } from './routes-admin-seo.js';
import { detectBot, recordBotHit, pruneAnalytics } from './lib/analytics.js';
import { seedKnowledgeBase } from './lib/kb.js';
import { startTelegramBot } from './lib/telegram-bot.js';
import { injectSeo, seoForPath } from './lib/seo-head.js';
import { installAppLogHooks, installProcessLogHandlers, registerLogRoutes, pruneAppLogs } from './lib/app-log.js';
import { startBillingSweeper, providerConfigured } from './billing.js';
import { startSubscriptionSweeper } from './lib/subscription.js';
import { startMailQueue } from './lib/mail-queue.js';
import { getSetting, setSetting } from './settings.js';
import { sessionUser } from './auth.js';
import { notifyConfigured } from './notify.js';
import { rateLimitHook, securityHeaders, sameOriginGuard } from './security.js';
import { db } from './db.js';
import { cleanupExpiredJobs } from './jobs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// В cluster-режиме фоновые задачи и Telegram-бот запускает только один worker.
const CLUSTER_WORKER = process.env.CLUSTER_WORKER === '1';
const RUN_SERVICES = !CLUSTER_WORKER || process.env.CLUSTER_SERVICES === '1';
const app = Fastify({ logger: true, trustProxy: '127.0.0.1', bodyLimit: 8 * 1024 * 1024 });

const MAINTENANCE_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>CODE QR PRO — технические работы</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b18;color:#e2e8f0;font:16px/1.5 system-ui,sans-serif}.card{max-width:520px;margin:24px;padding:32px;border:1px solid rgba(129,140,248,.3);border-radius:20px;background:rgba(255,255,255,.04)}h1{font-size:24px;margin:0 0 10px;background:linear-gradient(90deg,#a78bfa,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}p{color:#94a3b8;margin:0 0 12px}a{color:#a78bfa}</style></head><body><div class="card"><h1>CODE QR PRO</h1><p>Сервис временно недоступен — проводим технические работы.</p><p>Попробуйте обновить страницу через несколько минут. Если срочно — напишите на <a href="mailto:code-qr-pro@mail.ru">code-qr-pro@mail.ru</a>.</p></div></body></html>`;

async function maintenanceMode(req, reply) {
  try {
    if (getSetting('maintenance_mode', '0') !== '1') return;
    const until = String(getSetting('maintenance_until', '') || '');
    if (until && Date.parse(until) && Date.parse(until) < Date.now()) {
      setSetting('maintenance_mode', '0');
      setSetting('maintenance_until', '');
      return;
    }
    const url = String(req.raw.url || req.url || '/');
    const path = url.split('?')[0];
    if (path === '/api/health' || path.startsWith('/assets/') || path === '/favicon.svg' || path === '/site.webmanifest' || path === '/og-image.png') return;
    // Статические файлы/письма/иконки не должны ломаться в режиме обслуживания.
    if (/\.(png|jpe?g|webp|gif|svg|ico|css|js|map|woff2?|txt|xml|json)$/i.test(path) && !path.startsWith('/api/')) return;
    if (path === '/api/billing/webhook/yookassa' || path === '/maintenance') return;
    if (path === '/login' || path === '/register' || path === '/api/auth/login' || path === '/api/auth/register' || path.startsWith('/api/2fa/')) return;
    let user = null;
    try {
      const raw = String(req.headers.cookie || '');
      const m = /(?:^|;\s*)cq_session=([^;]+)/.exec(raw);
      user = m ? sessionUser(decodeURIComponent(m[1])) : null;
    } catch { user = null; }
    if (user && ['admin', 'support'].includes(user.role)) return;
    if (path.startsWith('/api/')) return reply.code(503).send({ error: 'Сервис на техническом обслуживании', code: 'maintenance' });
    return reply.code(503).header('Retry-After', '120').type('text/html; charset=utf-8').send(MAINTENANCE_HTML);
  } catch { /* режим обслуживания не должен ронять сервер */ }
}
app.addHook('onRequest', securityHeaders);
app.addHook('onRequest', maintenanceMode);
app.addHook('onRequest', sameOriginGuard);
app.addHook('onRequest', rateLimitHook());
installAppLogHooks(app);
installProcessLogHandlers();

// Учёт визитов поисковых ботов по серверным запросам (люди учитываются маяком на странице).
app.addHook('onResponse', async (req, reply) => {
  try {
    if (req.method !== 'GET') return;
    const ua = req.headers['user-agent'] || '';
    const engine = detectBot(ua);
    if (!engine) return;
    const path = String(req.raw.url || '/').split('?')[0];
    if (path.startsWith('/api/') || path.startsWith('/assets/')) return;
    recordBotHit({ path, engine, ua, status: reply.statusCode });
  } catch { /* аналитика не должна влиять на ответ */ }
});
if (RUN_SERVICES) {
  setInterval(() => db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run(), 3600000).unref();
  setInterval(() => db.prepare("DELETE FROM audit_log WHERE created_at < datetime('now','-365 days')").run(), 86400000).unref();
  setInterval(() => db.prepare("DELETE FROM login_attempts WHERE last_at < datetime('now','-30 days')").run(), 86400000).unref();
  setInterval(() => db.prepare("DELETE FROM password_resets WHERE created_at < datetime('now','-7 days')").run(), 86400000).unref();
  setInterval(() => db.prepare("DELETE FROM login_events WHERE created_at < datetime('now','-90 days')").run(), 86400000).unref();
  setInterval(() => db.prepare("DELETE FROM view_sessions WHERE expires_at <= datetime('now')").run(), 3600000).unref();
  setInterval(cleanupExpiredJobs, 3600000).unref();
  setInterval(() => pruneAppLogs(), 3600000).unref();
  pruneAppLogs();
  cleanupExpiredJobs();
  pruneAnalytics();
}

await app.register(cookie);
await registerRoutes(app);
await registerTeamRoutes(app);
await registerPublicCheckRoutes(app);
await registerAnalyticsRoutes(app);
await registerAdminSeoRoutes(app);
await registerJobRoutes(app);
await registerLabelRoutes(app);
await registerBillingRoutes(app);
await registerAdminRoutes(app);
await registerAdminBankRoutes(app);
await registerAdminSystemRoutes(app);
await registerAdminUserRoutes(app);
await registerAdminOrderRoutes(app);
await registerAdminAnalyticsRoutes(app);
await registerTwoFactorRoutes(app);
await registerAdminAuditRoutes(app);
await registerAdminPromoRoutes(app);
await registerAdminMailRoutes(app);
await registerAdminStorageRoutes(app);
await registerApiRoutes(app);
await registerReviewRoutes(app);
await registerSetRoutes(app);
await registerAdRoutes(app);
await registerAdminSecurityRoutes(app);
await registerAdminAiRoutes(app);
await registerAdminBillingRoutes(app);
await registerAiSupportRoutes(app);
await registerLogRoutes(app);
if (RUN_SERVICES) {
  seedKnowledgeBase();
  startBillingSweeper();
  startSubscriptionSweeper();
  startTelegramBot();
  startMailQueue();
}
app.log.info({ yookassaConfigured: providerConfigured(), telegramNotify: notifyConfigured() }, 'billing ready');

const dist = join(__dirname, '..', '..', 'web', 'dist');
const indexHtmlPath = join(dist, 'index.html');
if (existsSync(dist)) {
  // index.html читаем один раз; для публичных URL кэшируем уже собранный head,
  // чтобы не делать readFile + набор regex на каждый запрос робота/страницы.
  let indexHtml = readFileSync(indexHtmlPath, 'utf8');
  let indexMtime = statSync(indexHtmlPath).mtimeMs;
  const seoHtmlCache = new Map();
  const SEO_HTML_TTL_MS = 60 * 1000;
  const SEO_HTML_MAX_PATHS = 400;
  const publicIndexHtml = (path) => {
    // Web можно задеплоить без рестарта Node: если index.html пересобран,
    // подхватываем новый хэш assets и сбрасываем SEO-кэш.
    try {
      const mtime = statSync(indexHtmlPath).mtimeMs;
      if (mtime !== indexMtime) {
        indexHtml = readFileSync(indexHtmlPath, 'utf8');
        indexMtime = mtime;
        seoHtmlCache.clear();
      }
    } catch { /* оставляем предыдущий index.html */ }
    const now = Date.now();
    const hit = seoHtmlCache.get(path);
    if (hit && now - hit.at < SEO_HTML_TTL_MS) return hit.html;
    const html = injectSeo(indexHtml, path);
    if (seoHtmlCache.size >= SEO_HTML_MAX_PATHS) {
      const oldest = seoHtmlCache.keys().next();
      if (!oldest.done) seoHtmlCache.delete(oldest.value);
    }
    seoHtmlCache.set(path, { html, at: now });
    return html;
  };
  await app.register(fastifyStatic, {
    root: dist,
    prefix: '/',
    // index.html отдаёт наш обработчик: он подставляет canonical и Cache-Control.
    index: false,
    setHeaders(res, path) {
      if (path.includes(`${sep}assets${sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  });
  app.setNotFoundHandler((req, reply) => {
    const rawUrl = String(req.raw.url || '/');
    const path = rawUrl.split('?')[0];
    if (path.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    if (path.startsWith('/assets/')) return reply.code(404).send({ error: 'Not found' });
    // Единый canonical-формат без завершающего слэша: /pricing/ -> /pricing,
    // /articles/ -> /articles. Иначе SPA отдаёт 200/404 вперемешку и плодит дубли.
    if (path !== '/' && path.endsWith('/')) {
      const clean = path.replace(/\/+$/, '') || '/';
      const query = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
      return reply.redirect(301, clean + query);
    }
    const isPrivate = path === '/login' || path === '/register' || path === '/app' || path.startsWith('/app/');
    if (isPrivate) {
      reply.header('X-Robots-Tag', 'noindex, nofollow');
      return reply.sendFile('index.html');
    }
    const publicPaths = new Set(['/check', '/pricing', '/articles', '/faq', '/offer', '/terms', '/privacy']);
    // Несуществующая статья должна отдавать 404, а не soft-200 с главной.
    if (path.startsWith('/articles/') && !seoForPath(path)) {
      reply.code(404).header('X-Robots-Tag', 'noindex, nofollow');
      return reply.sendFile('index.html');
    }
    const isPublic = publicPaths.has(path) || path.startsWith('/articles/');
    if (path === '/' || isPublic) {
      // Отдаём роботам уже правильный canonical/title/description. SPA всё равно
      // обновит head после гидрации, но исходный HTML больше не указывает canonical на «/».
      try {
        reply.header('X-Robots-Tag', 'index, follow');
        reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return reply.type('text/html; charset=utf-8').send(publicIndexHtml(path));
      } catch {
        return reply.sendFile('index.html');
      }
    }
    reply.code(404).header('X-Robots-Tag', 'noindex, nofollow');
    return reply.sendFile('index.html');
  });

  // Понятные ответы вместо 500 на типовые ошибки клиентов и статики.
  app.setErrorHandler((err, req, reply) => {
    const code = String(err?.code || '');
    const path = String(req.raw.url || '/').split('?')[0];
    if (path.startsWith('/assets/') && (code === 'EACCES' || code === 'ENOENT')) {
      // при деплое старый хеш ассета мог исчезнуть — отдаём 404, а не 500
      return reply.code(404).send({ error: 'Not found' });
    }
    if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.code(415).send({ error: 'Неверный формат запроса: ожидается JSON' });
    }
    if (code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return reply.code(400).send({ error: 'Пустое тело запроса' });
    }
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: 'Слишком большой запрос' });
    }
    const status = Number(err?.statusCode) >= 400 && Number(err?.statusCode) < 600 ? Number(err.statusCode) : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    return reply.code(status).send({ error: status >= 500 ? 'Внутренняя ошибка сервера' : String(err?.message || 'Ошибка запроса') });
  });
}

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';
await app.listen({ port, host });
