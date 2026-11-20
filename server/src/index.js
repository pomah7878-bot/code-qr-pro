import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
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
import { installAppLogHooks, installProcessLogHandlers, registerLogRoutes, pruneAppLogs } from './lib/app-log.js';
import { startBillingSweeper, providerConfigured } from './billing.js';
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

await app.register(cookie);
await registerRoutes(app);
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
await registerLogRoutes(app);
startBillingSweeper();
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
    if (path === '/') return reply.sendFile('index.html');
    reply.code(404).header('X-Robots-Tag', 'noindex, nofollow');
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';
await app.listen({ port, host });
