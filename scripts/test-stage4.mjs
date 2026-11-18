// Smoke-тест этапа 4 (сервер с чистой БД на :3101): node scripts/test-stage4.mjs
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3101';
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
  return { status: res.status, data };
}
function assert(cond, msg, dump) { if (!cond) { console.error('FAIL:', msg, dump ? JSON.stringify(dump).slice(0, 500) : ''); process.exit(1); } console.log('ok:', msg); }
const noCookie = () => { cookie = ''; };

// первый пользователь = админ
let r = await req('POST', '/api/auth/register', { email: 'admin@test.local', password: 'testpass123', name: 'Admin' });
assert(r.status === 200 && r.data.user.role === 'admin', 'первый пользователь = админ', r);
const adminCookie = cookie;

r = await req('POST', '/api/auth/register', { email: 'user@test.local', password: 'testpass123', name: 'User' });
assert(r.status === 200 && r.data.user.role === 'user', 'второй пользователь = user');
const userCookie = cookie;

// админка закрыта для обычных
cookie = userCookie;
r = await req('GET', '/api/admin/stats');
assert(r.status === 403, 'админка: 403 для user');

cookie = adminCookie;
r = await req('GET', '/api/admin/stats');
assert(r.status === 200 && r.data.users === 2, 'админка: stats', r);

// управление тарифом
r = await req('GET', '/api/admin/users');
const uid = r.data.users.find(u => u.email === 'user@test.local').id;
r = await req('POST', `/api/admin/users/${uid}/plan`, { plan: 'premium' });
assert(r.status === 200, 'админ: выдача premium');
cookie = userCookie;
r = await req('GET', '/api/me');
assert(r.data.user.plan === 'premium', 'user стал premium');
r = await req('GET', '/api/billing/subscription');
assert(r.data.subscription && r.data.subscription.provider === 'admin', 'подписка admin активна');

// checkout без ключей YooKassa → честные 503
r = await req('POST', '/api/billing/checkout', { plan: 'premium' });
assert(r.status === 503, 'checkout без провайдера → 503', r);
r = await req('GET', '/api/billing/subscription');
assert(r.data.providerConfigured === false, 'providerConfigured=false');

// ЧЗ: локальная валидация + статус
const GOOD = '(01)04600000000015(21)5PojkV(91)EE10(92)dGVzdA==';
const BAD = '(01)04600000000016(21)ABC';
r = await req('POST', '/api/cz/verify', { codes: [GOOD, BAD] });
assert(r.status === 200 && r.data.configured === false && r.data.results[0].ok === true && r.data.results[1].ok === false, 'ЧЗ: локальная валидация + не подключено', r);

cookie = adminCookie;
r = await req('PUT', '/api/admin/settings', { czEnabled: true, czApiUrl: 'https://api.mdlp.crpt.ru', czToken: 'test-token-123' });
assert(r.status === 200, 'админ: настройки ЧЗ сохранены');
r = await req('GET', '/api/admin/settings');
assert(r.data.czEnabled === true && r.data.czConfigured === true && !JSON.stringify(r.data).includes('test-token-123'), 'ЧЗ: токен не утекает в GET');
cookie = userCookie;
r = await req('POST', '/api/cz/verify', { codes: [GOOD] });
assert(r.data.configured === true && r.data.online === false, 'ЧЗ: configured=true, online=false (честный статус)');

// API-ключи
r = await req('POST', '/api/keys', { name: '1С тест' });
assert(r.status === 200 && r.data.key.startsWith('cq_'), 'создание API-ключа');
const key = r.data.key;
noCookie();
r = await req('GET', '/api/v1/me', null, { 'X-API-Key': key });
assert(r.status === 200 && r.data.user.plan === 'premium', 'API: /v1/me по ключу');
r = await req('GET', '/api/v1/me', null, { 'X-API-Key': 'cq_bad' });
assert(r.status === 401, 'API: неверный ключ → 401');
r = await req('POST', '/api/v1/generate', { name: 'API пакет', mode: 'cz', format: 'png', rows: [GOOD, GOOD] }, { 'X-API-Key': key });
assert(r.status === 200, 'API: генерация', r);
const jobId = r.data.job.id;
let job;
for (let i = 0; i < 30; i++) { await new Promise(res => setTimeout(res, 250)); r = await req('GET', `/api/v1/jobs/${jobId}`, null, { 'X-API-Key': key }); job = r.data.job; if (job.status === 'done' || job.status === 'error') break; }
assert(job.status === 'done' && job.done === 2, 'API: задание выполнено');

// отзыв ключа
cookie = userCookie;
r = await req('GET', '/api/keys');
const kid = r.data.keys[0].id;
r = await req('DELETE', '/api/keys/' + kid);
assert(r.status === 200, 'отзыв ключа');
noCookie();
r = await req('GET', '/api/v1/me', null, { 'X-API-Key': key });
assert(r.status === 401, 'отозванный ключ → 401');

// деградация до free закрывает API
cookie = adminCookie;
await req('POST', `/api/admin/users/${uid}/plan`, { plan: 'free' });
cookie = userCookie;
r = await req('POST', '/api/keys', { name: 'x' });
assert(r.status === 403, 'FREE: создание ключей → 403');

console.log('\nALL STAGE 4 TESTS PASSED');
