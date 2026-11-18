import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';
import { registerJobRoutes } from './routes-jobs.js';
import { registerLabelRoutes } from './routes-labels.js';
import { registerBillingRoutes } from './routes-billing.js';
import { registerAdminRoutes } from './routes-admin.js';
import { registerApiRoutes } from './routes-api.js';
import { startBillingSweeper, providerConfigured } from './billing.js';
import { notifyConfigured } from './notify.js';
import { rateLimitHook, securityHeaders } from './security.js';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 8 * 1024 * 1024 });

app.addHook('onRequest', securityHeaders);
app.addHook('onRequest', rateLimitHook());
setInterval(() => db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run(), 3600000).unref();

await app.register(cookie);
await registerRoutes(app);
await registerJobRoutes(app);
await registerLabelRoutes(app);
await registerBillingRoutes(app);
await registerAdminRoutes(app);
await registerApiRoutes(app);
startBillingSweeper();
app.log.info({ yookassaConfigured: providerConfigured(), telegramNotify: notifyConfigured() }, 'billing ready');

const dist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';
await app.listen({ port, host });
