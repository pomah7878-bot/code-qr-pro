// Smoke-тест этапа 2 (запускать при работающем сервере :3100): node scripts/test-stage2.mjs
import Database from '../server/node_modules/better-sqlite3/lib/index.js';

const BASE = 'http://127.0.0.1:3100';
let cookie = '';
async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}
function assert(cond, msg, dump) { if (!cond) { console.error('FAIL:', msg, dump ? JSON.stringify(dump).slice(0, 600) : ''); process.exit(1); } console.log('ok:', msg); }

const email = `stage2-${Date.now()}@test.local`;
let r = await req('POST', '/api/auth/register', { email, password: 'testpass123', name: 'Stage2 Test' });
assert(r.status === 200, 'register');

const GOOD_PAREN = '(01)04600000000015(21)5PojkV(91)EE10(92)dGVzdA==';
const GOOD_RAW = '0104600000000015215PojkV\x1d91EE10\x1d92dGVzdA==';
const BAD_GTIN = '(01)04600000000016(21)ABC(91)EE10(92)dGVzdA==';
const NO_CRYPTO = '(01)04600000000015(21)ABC';

r = await req('POST', '/api/jobs/validate', { mode: 'cz', rows: [GOOD_PAREN, GOOD_RAW, BAD_GTIN, NO_CRYPTO] });
assert(r.status === 200 && r.data.valid === 2, 'validate: 2 из 4 валидны', r);
assert(r.data.items[2].error.includes('контрольная'), 'validate: ошибка контрольной цифры GTIN');
assert(r.data.items[3].error.includes('криптохвоста'), 'validate: отсутствие криптохвоста');
assert(r.data.items[1].gtin === '04600000000015', 'validate: raw GS-формат разобран (01+21 без GS)');

r = await req('POST', '/api/jobs', { name: 'Тестовый пакет', mode: 'cz', format: 'png', rows: [GOOD_PAREN, GOOD_RAW, BAD_GTIN] });
assert(r.status === 200, 'create job');
const jobId = r.data.job.id;
assert(r.data.job.valid === 2 && r.data.job.total === 3, 'job: total=3 valid=2');

let job;
for (let i = 0; i < 30; i++) {
  await new Promise(res => setTimeout(res, 300));
  r = await req('GET', `/api/jobs/${jobId}`);
  job = r.data.job;
  if (job.status === 'done' || job.status === 'error') break;
}
assert(job.status === 'done' && job.done === 2, 'generation done=2');

r = await req('GET', `/api/jobs/${jobId}/item/0.png`);
assert(r.status === 200 && r.data.slice(1, 4).toString() === 'PNG', 'item PNG валиден');
r = await req('GET', `/api/jobs/${jobId}/item/1.svg`);
assert(r.status === 200 && r.data.toString().includes('<svg'), 'item SVG валиден');

r = await req('GET', `/api/jobs/${jobId}/export?format=zip`);
assert(r.status === 403, 'FREE: zip запрещён (403)');

// повышаем тариф локально для проверки premium-экспорта
const db = new Database('server/data/app.db');
db.prepare("UPDATE users SET plan='premium' WHERE email=?").run(email);
db.close();

r = await req('GET', `/api/jobs/${jobId}/export?format=zip`);
assert(r.status === 200 && r.data.slice(0, 2).toString() === 'PK', 'PREMIUM: ZIP валиден');
r = await req('GET', `/api/jobs/${jobId}/export?format=pdf`);
assert(r.status === 200 && r.data.slice(0, 4).toString() === '%PDF', 'PREMIUM: PDF валиден');

r = await req('GET', '/api/me');
assert(r.data.usage.codesToday === 2, 'usage: учтено 2 кода');

r = await req('DELETE', `/api/jobs/${jobId}`);
assert(r.status === 200, 'delete job');

// текстовый режим
r = await req('POST', '/api/jobs', { name: 'text', mode: 'text', format: 'png', rows: ['hello world'] });
assert(r.status === 200, 'text mode job');
const tj = r.data.job.id;
for (let i = 0; i < 20; i++) { await new Promise(res => setTimeout(res, 200)); r = await req('GET', `/api/jobs/${tj}`); if (r.data.job.status === 'done') break; }
assert(r.data.job.status === 'done', 'text mode done');
await req('DELETE', `/api/jobs/${tj}`);

console.log('\nALL STAGE 2 TESTS PASSED');
