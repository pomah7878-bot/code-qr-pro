import Fastify from 'fastify';
import { db } from '../src/db.js';
import { installAppLogHooks, pruneAppLogs } from '../src/lib/app-log.js';

const app = Fastify({ logger: false });
installAppLogHooks(app, { slowMs: 50 });

app.get('/boom', async () => { throw new Error('test boom'); });
app.get('/slow', async () => {
  await new Promise((r) => setTimeout(r, 120));
  return { ok: true };
});
app.get('/fine', async () => ({ ok: true }));

await app.inject({ method: 'GET', url: '/boom' });
await app.inject({ method: 'GET', url: '/slow' });
await app.inject({ method: 'GET', url: '/fine' });
await new Promise((r) => setTimeout(r, 100));

const rows = db.prepare('SELECT level, source, event, message, method, url, status FROM app_logs ORDER BY id').all();
console.log(JSON.stringify({ count: rows.length, rows }, null, 1));

const removed = pruneAppLogs({ days: 30 });
console.log('pruned:', removed);
await app.close();
