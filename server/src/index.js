import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';
import { registerJobRoutes } from './routes-jobs.js';
import './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true, trustProxy: true });

await app.register(cookie);
await registerRoutes(app);
await registerJobRoutes(app);

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
