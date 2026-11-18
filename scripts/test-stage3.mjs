// Smoke-тест этапа 3 (при работающем сервере :3100): node scripts/test-stage3.mjs
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
function assert(cond, msg, dump) { if (!cond) { console.error('FAIL:', msg, dump ? JSON.stringify(dump).slice(0, 500) : ''); process.exit(1); } console.log('ok:', msg); }

const email = `stage3-${Date.now()}@test.local`;
let r = await req('POST', '/api/auth/register', { email, password: 'testpass123', name: 'Stage3' });
assert(r.status === 200, 'register');

const TPL = { name: 'Тест 58x40', widthMm: 58, heightMm: 40, dpi: 203, elements: [
  { id: 'dm', type: 'datamatrix', x: 2, y: 2, w: 24, h: 24 },
  { id: 'g', type: 'field', field: 'gtin', x: 28, y: 2, w: 28, h: 6, fontSize: 8, align: 'left' },
  { id: 's', type: 'field', field: 'serial', x: 28, y: 10, w: 28, h: 6, fontSize: 8, align: 'left' },
  { id: 't', type: 'text', text: 'CODE QR PRO', x: 28, y: 30, w: 28, h: 6, fontSize: 7, align: 'center' }
] };

r = await req('POST', '/api/templates', TPL);
assert(r.status === 200 && r.data.template.id, 'template create');
const tplId = r.data.template.id;
r = await req('GET', '/api/templates');
assert(r.data.templates.length === 1, 'template list');
r = await req('PUT', '/api/templates/' + tplId, { ...TPL, name: 'Тест обновлённый' });
assert(r.status === 200 && r.data.template.name === 'Тест обновлённый', 'template update');
r = await req('POST', '/api/templates', { ...TPL, widthMm: 5 });
assert(r.status === 400, 'template validation: размер отклонён');

// FREE: prepare запрещён
r = await req('POST', '/api/labels/prepare', { template: TPL, data: { code: '(01)04600000000015(21)ABC' } });
assert(r.status === 403, 'FREE: prepare 403');

const db = new Database('server/data/app.db');
db.prepare("UPDATE users SET plan='premium' WHERE email=?").run(email);
db.close();

const GOOD = '(01)04600000000015(21)5PojkV(91)EE10(92)dGVzdA==';
r = await req('POST', '/api/jobs', { name: 'Для этикеток', mode: 'cz', format: 'png', rows: [GOOD, GOOD] });
assert(r.status === 200, 'job create');
const jobId = r.data.job.id;
let job;
for (let i = 0; i < 30; i++) { await new Promise(res => setTimeout(res, 250)); r = await req('GET', '/api/jobs/' + jobId); job = r.data.job; if (job.status === 'done' || job.status === 'error') break; }
assert(job.status === 'done', 'job done');

r = await req('POST', '/api/labels/prepare', { template: TPL, jobId, row: 0 });
assert(r.status === 200, 'prepare ok', r);
const dm = r.data.elements.find(e => e.type === 'datamatrix');
assert(dm && Buffer.from(dm.pngBase64, 'base64').slice(1, 4).toString() === 'PNG', 'prepare: DataMatrix PNG');
assert(r.data.elements.find(e => e.id === 'g').text === '04600000000015', 'prepare: поле GTIN разрешено');
assert(r.data.elements.find(e => e.id === 's').text === '5PojkV', 'prepare: поле Serial разрешено');

r = await req('POST', '/api/labels/pdf', { template: TPL, jobId });
assert(r.status === 200 && r.data.slice(0, 4).toString() === '%PDF', 'labels PDF валиден');

await req('DELETE', '/api/jobs/' + jobId);
r = await req('DELETE', '/api/templates/' + tplId);
assert(r.status === 200, 'template delete');

console.log('\nALL STAGE 3 API TESTS PASSED');
