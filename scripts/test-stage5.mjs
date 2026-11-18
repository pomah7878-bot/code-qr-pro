// Smoke-тест этапа 5 — безопасность (при работающем сервере :3100): node scripts/test-stage5.mjs
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3100';
let cookie = '';
async function req(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}
function assert(cond, msg, dump) { if (!cond) { console.error('FAIL:', msg, dump ? JSON.stringify(dump).slice(0, 400) : ''); process.exit(1); } console.log('ok:', msg); }

let r = await req('GET', '/api/health');
assert(r.data.stage === 5, 'health stage 5');

r = await req('GET', '/api/health', null, { 'X-Forwarded-Proto': 'https' });
assert(r.headers.get('x-content-type-options') === 'nosniff', 'header nosniff');
assert(r.headers.get('x-frame-options') === 'DENY', 'header X-Frame-Options');
assert(r.headers.get('strict-transport-security')?.includes('max-age=31536000'), 'header HSTS');
assert(r.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'header Referrer-Policy');

r = await req('GET', '/api/plans');
assert(r.data.plans.find(p => p.id === 'premium').priceMonthly === 1990, 'PREMIUM = 1990');

r = await req('POST', '/api/auth/register', { email: `stage5-${Date.now()}@test.local`, password: 'testpass123', name: 'S5' });
assert(r.status === 200, 'register');

// path traversal в номере строки
r = await req('GET', '/api/jobs/1/item/..%2f..%2f..%2fapp.db.png');
assert(r.status === 400, 'traversal в :row → 400', r);
r = await req('GET', '/api/jobs/1/item/abc.svg');
assert(r.status === 400, 'нечисловой :row → 400');

// oversized body → 413
const big = { name: 'big', mode: 'text', rows: Array(2000).fill('x'.repeat(5000)) };
r = await req('POST', '/api/jobs', big);
assert(r.status === 413, 'тело >8МБ → 413', r);

// глобальный rate-limit (последним: исчерпывает лимит IP)
let got429 = false;
for (let i = 0; i < 320; i++) {
  const res = await fetch(BASE + '/api/plans');
  if (res.status === 429) { got429 = true; break; }
}
assert(got429, 'глобальный rate-limit срабатывает (429)');

console.log('\nALL STAGE 5 SECURITY TESTS PASSED');
