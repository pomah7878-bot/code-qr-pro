// Тест тарифа TEST (сервер :3101 с чистой БД test-plan.db): node scripts/test-testplan.mjs
import Database from '../server/node_modules/better-sqlite3/lib/index.js';
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3101';
const DBFILE = process.env.TEST_DB || 'server/data/test-plan.db';
let cookie = '';
async function req(m, p, b) {
  const res = await fetch(BASE + p, { method: m, headers: { ...(b ? {'Content-Type':'application/json'} : {}), ...(cookie ? {cookie} : {}) }, body: b ? JSON.stringify(b) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
function assert(c, m, d) { if (!c) { console.error('FAIL:', m, d ? JSON.stringify(d).slice(0,400) : ''); process.exit(1); } console.log('ok:', m); }

let r = await req('POST', '/api/auth/register', { email: 'admin@test.local', password: 'testpass123', name: 'A' });
assert(r.data.user.role === 'admin', 'первый = админ');
const adminCookie = cookie;
r = await req('POST', '/api/auth/register', { email: 'user@test.local', password: 'testpass123', name: 'U' });
const userCookie = cookie;

cookie = userCookie;
r = await req('POST', '/api/billing/checkout', { plan: 'test' });
assert(r.status === 403, 'test недоступен не-админу (403)', r);
r = await req('POST', '/api/billing/checkout', { plan: 'hacker' });
assert(r.status === 400, 'неизвестный тариф → 400');

cookie = adminCookie;
r = await req('POST', '/api/billing/checkout', { plan: 'test' });
assert(r.status === 503, 'test принят, доходит до провайдера (503 без ключей)', r);

r = await req('GET', '/api/plans');
const t = r.data.plans.find(p => p.id === 'test');
assert(t && t.priceMonthly === 1 && t.apiAccess && t.labelEditor, 'TEST = 1₽ с полными premium-правами', t);

// эмуляция успешной оплаты test-заказа: пишем paid-заказ + активную premium-подписку напрямую в БД,
// затем проверяем, что API /me отдаёт premium и subscription показывает активность
const db = new Database(DBFILE);
const uid = db.prepare("SELECT id FROM users WHERE email='admin@test.local'").get().id;
const exp = new Date(Date.now() + 30*86400000).toISOString().replace('T',' ').slice(0,19);
db.transaction(() => {
  const o = db.prepare("INSERT INTO orders (user_id, plan, amount, status, provider, external_id, paid_at) VALUES (?, 'test', 1, 'paid', 'yookassa', 'fake-1', datetime('now'))").run(uid);
  db.prepare("INSERT INTO subscriptions (user_id, plan, status, provider, external_id, started_at, expires_at) VALUES (?, 'premium', 'active', 'yookassa', 'fake-1', datetime('now'), ?)").run(uid, exp);
  db.prepare("UPDATE users SET plan='premium' WHERE id=?").run(uid);
})();
db.close();

cookie = adminCookie;
r = await req('GET', '/api/me');
assert(r.data.user.plan === 'premium' && r.data.plan.apiAccess === true, 'после оплаты test → premium-доступ по API', r.data.user);
r = await req('GET', '/api/billing/subscription');
assert(r.data.subscription && r.data.subscription.plan === 'premium', 'подписка premium активна', r.data);
r = await req('GET', '/api/billing/orders');
const ord = r.data.orders.find(o => o.plan === 'test');
assert(ord && ord.amount === 1 && ord.status === 'paid', 'в истории: test-заказ 1₽ оплачен', ord);

console.log('\nALL TEST-PLAN TESTS PASSED');
