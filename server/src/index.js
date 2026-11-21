import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import dns from 'node:dns';
import { existsSync } from 'node:fs';

// У VPS нет рабочего IPv6, а DNS отдаёт AAAA первым: Node ходил по IPv6 и падал
// (например, уведомления в Telegram). Принудительно используем IPv4.
dns.setDefaultResultOrder('ipv4first');
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';
import { registerJobRoutes } from './routes-jobs.js';
import { registerLabelRoutes } from './routes-labels.js';
import { registerBillingRoutes } from './routes-billing.js';
import { registerAdminRoutes } from './routes-admin.js';
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
import { installAppLogHooks, installProcessLogHandlers, registerLogRoutes, pruneAppLogs } from './lib/app-log.js';
import { startBillingSweeper, providerConfigured } from './billing.js';
import { startSubscriptionSweeper } from './lib/subscription.js';
import { startMailQueue } from './lib/mail-queue.js';
import { notifyConfigured } from './notify.js';
import { rateLimitHook, securityHeaders, sameOriginGuard } from './security.js';
import { db } from './db.js';
import { cleanupExpiredJobs } from './jobs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true, trustProxy: '127.0.0.1', bodyLimit: 8 * 1024 * 1024 });

app.addHook('onRequest', securityHeaders);
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

await app.register(cookie);
await registerRoutes(app);
await registerAnalyticsRoutes(app);
await registerAdminSeoRoutes(app);
await registerJobRoutes(app);
await registerLabelRoutes(app);
await registerBillingRoutes(app);
await registerAdminRoutes(app);
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
seedKnowledgeBase();
startBillingSweeper();
startSubscriptionSweeper();
startMailQueue();
app.log.info({ yookassaConfigured: providerConfigured(), telegramNotify: notifyConfigured() }, 'billing ready');

const dist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, {
    root: dist,
    prefix: '/',
    setHeaders(res, path) {
      if (path.includes(`${sep}assets${sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  });
  app.setNotFoundHandler((req, reply) => {
    const path = String(req.raw.url || '/').split('?')[0];
    if (path.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    if (path.startsWith('/assets/')) return reply.code(404).send({ error: 'Not found' });
    const isPrivate = path === '/login' || path === '/register' || path === '/app' || path.startsWith('/app/');
    if (isPrivate) {
      reply.header('X-Robots-Tag', 'noindex, nofollow');
      return reply.sendFile('index.html');
    }
    const publicPaths = new Set(['/pricing', '/articles', '/faq', '/offer', '/terms', '/privacy']);
    const isPublic = publicPaths.has(path) || path.startsWith('/articles/');
    if (path === '/' || isPublic) return reply.sendFile('index.html');
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
