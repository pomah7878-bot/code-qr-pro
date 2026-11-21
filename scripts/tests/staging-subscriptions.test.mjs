import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

const BASE = 'http://127.0.0.1:3200';
const DB_PATH = '/opt/code-qr-staging/server/data/app.db';
const db = new Database(DB_PATH);
const results = [];
const idsExtra = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: Boolean(cond), extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createUser(plan = 'free', role = 'user') {
  const email = `qa-${Date.now()}-${randomBytes(3).toString('hex')}@example.com`;
  const token = 't' + randomBytes(24).toString('hex');
  const id = db.prepare("INSERT INTO users (email, password_hash, name, role, plan) VALUES (?, 'x', 'QA', ?, ?)")
    .run(email, role, plan).lastInsertRowid;
  db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .run(token, randomBytes(8).toString('hex'), id, new Date(Date.now() + 86400000).toISOString(), '127.0.0.1', 'qa');
  return { id, email, token };
}

async function api(token, method, path, body, headers = {}) {
  const sendsJson = body !== undefined || ['POST', 'PUT', 'PATCH'].includes(method);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Cookie: `cq_session=${token}`,
      ...(sendsJson ? { 'Content-Type': 'application/json' } : {}),
      Origin: BASE,
      ...headers
    },
    body: sendsJson ? JSON.stringify(body === undefined ? {} : body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

const gtin = '04638230913287';
const gs1Code = (i) => `(01)${gtin}(21)QA${String(i).padStart(4, '0')}`;
const fullCode = (i) => `(01)${gtin}(21)QA${String(i).padStart(4, '0')}(91)EE12(92)${'A'.repeat(12)}${i}`;
const template = {
  name: 'QA 58x40', widthMm: 58, heightMm: 40, dpi: 203,
  elements: [{ id: 'dm', type: 'datamatrix', x: 2, y: 2, w: 18, h: 18 }]
};

console.log('=== migration / plans ===');
const version = db.pragma('user_version', { simple: true });
ok('user_version = 35', version === 35, `version=${version}`);
const planRows = db.prepare('SELECT id, title, price_monthly, ops_per_period, checks_per_period FROM plans ORDER BY sort_order').all();
ok('4 тарифа в БД', planRows.length === 4, JSON.stringify(planRows));
ok('цены тарифов 149/349/799', planRows[1]?.price_monthly === 149 && planRows[2]?.price_monthly === 349 && planRows[3]?.price_monthly === 799);
const premiumMapped = db.prepare("SELECT COUNT(*) c FROM users WHERE plan='premium'").get().c;
ok('старый premium переведён в pro', premiumMapped === 0, `premium users=${premiumMapped}`);

console.log('\n=== публичные тарифы ===');
const plansRes = await fetch(BASE + '/api/plans').then((r) => r.json());
ok('/api/plans отдаёт 4+ тарифа', Array.isArray(plansRes.list) && plansRes.list.length >= 4, `list=${plansRes.list?.length}`);
const proPlan = plansRes.list.find((p) => p.id === 'pro');
ok('PRO: 349 ₽, 5000 операций, 500 проверок', proPlan.priceMonthly === 349 && proPlan.opsPerPeriod === 5000 && proPlan.checksPerPeriod === 500);

console.log('\n=== free + trial ===');
const free = createUser('free');
let me = await api(free.token, 'GET', '/api/me');
ok('free: /api/me план free', me.data?.plan?.id === 'free', JSON.stringify(me.data?.plan?.id));
ok('free: 600 операций/мес, 20/день', me.data?.usage?.ops?.limit === 600 && me.data?.usage?.daily?.limit === 20);
ok('free: 0 расширенных проверок', me.data?.usage?.checks?.limit === 0);
const trial = await api(free.token, 'POST', '/api/billing/trial');
ok('trial активируется', trial.status === 200 && trial.data?.trial?.active === true, JSON.stringify(trial.data?.error));
me = await api(free.token, 'GET', '/api/me');
ok('trial: план PRO, 50 проверок', me.data?.plan?.id === 'pro' && me.data?.usage?.checks?.limit === 50, `source=${me.data?.plan?.source}`);
const trialAgain = await api(free.token, 'POST', '/api/billing/trial');
ok('повторный trial запрещён (409)', trialAgain.status === 409);

console.log('\n=== free: суточный лимит операций ===');
const free2 = createUser('free');
const bigRows = Array.from({ length: 21 }, (_, i) => gs1Code(i + 1));
const over = await api(free2.token, 'POST', '/api/jobs', { mode: 'gs1', format: 'png', rows: bigRows });
ok('21 код > лимита пакета FREE (400)', over.status === 400 && /Пакет больше лимита/.test(over.data?.error || ''), JSON.stringify(over.data?.error));
const rows15 = Array.from({ length: 15 }, (_, i) => gs1Code(i + 1));
const job1 = await api(free2.token, 'POST', '/api/jobs', { mode: 'gs1', format: 'png', rows: rows15 }, { 'X-Idempotency-Key': 'qa-job-1' });
ok('15 кодов принимаются', job1.status === 200 && job1.data?.job?.valid === 15);
const meAfterGen = await api(free2.token, 'GET', '/api/me');
ok('списано 15 операций', meAfterGen.data?.usage?.ops?.used === 15 && meAfterGen.data?.usage?.daily?.used === 15, JSON.stringify(meAfterGen.data?.usage?.ops));
const jobDup = await api(free2.token, 'POST', '/api/jobs', { mode: 'gs1', format: 'png', rows: rows15 }, { 'X-Idempotency-Key': 'qa-job-1' });
const meAfterDup = await api(free2.token, 'GET', '/api/me');
ok('повтор с тем же idemKey не создаёт дубль', jobDup.data?.job?.id === job1.data?.job?.id, `id=${jobDup.data?.job?.id}`);
ok('повтор не списывает повторно', meAfterDup.data?.usage?.ops?.used === 15, `used=${meAfterDup.data?.usage?.ops?.used}`);

console.log('\n=== PDF: операции и лимит ===');
const pdfTooBig = await api(free2.token, 'POST', '/api/labels/pdf/ticket', { template, rows: Array.from({ length: 10 }, () => ({ code: gs1Code(1), gtin, serial: 'QA0001' })), single: true, source: 'reprint', idemKey: 'qa-pdf-1' });
ok('PDF 10 при остатке 5 → 402', pdfTooBig.status === 402, JSON.stringify(pdfTooBig.data));
const pdfOk = await api(free2.token, 'POST', '/api/labels/pdf/ticket', { template, rows: Array.from({ length: 5 }, () => ({ code: gs1Code(1), gtin, serial: 'QA0001' })), single: true, source: 'reprint', idemKey: 'qa-pdf-2' });
ok('PDF 5 → 200 и файл', pdfOk.status === 200 && Boolean(pdfOk.data?.url), JSON.stringify(pdfOk.data?.error));
const mePdf = await api(free2.token, 'GET', '/api/me');
ok('PDF списал 5 операций (итого 20)', mePdf.data?.usage?.daily?.used === 20, `daily=${mePdf.data?.usage?.daily?.used}`);

console.log('\n=== шаблоны: PRO-only ===');
const tplFree = await api(free2.token, 'POST', '/api/templates', template);
ok('FREE: сохранение шаблона запрещено', tplFree.status === 403 && tplFree.data?.feature === 'templates');
const trialUserTpl = await api(free.token, 'POST', '/api/templates', { ...template, name: 'QA trial tpl' });
ok('PRO/trial: шаблон сохраняется', trialUserTpl.status === 200, JSON.stringify(trialUserTpl.data?.error));

console.log('\n=== расширенная проверка DataMatrix ===');
db.prepare('DELETE FROM product_cards WHERE gtin=?').run(gtin);
const cards = await api(free.token, 'POST', '/api/product/cards', { codes: [{ code: fullCode(1), gtin }], idemKey: 'qa-card-1' });
const card = cards.data?.cards?.[0];
ok('карточка получена (trial/PRO)', cards.status === 200 && card?.ok === true, JSON.stringify(cards.data?.error));
ok('карточка содержит источник и поля', Boolean(card?.card?.source) && Boolean(card?.code?.gtin), JSON.stringify({ source: card?.card?.source, name: card?.card?.name, checks: card?.card?.checks }));
const meCard = await api(free.token, 'GET', '/api/me');
const checksAfter = meCard.data?.usage?.checks?.used || 0;
ok('расширенные проверки списаны', checksAfter > 0, `checks=${checksAfter}`);
const cardsDup = await api(free.token, 'POST', '/api/product/cards', { codes: [{ code: fullCode(1), gtin }], idemKey: 'qa-card-1' });
const meCard2 = await api(free.token, 'GET', '/api/me');
ok('повтор с тем же idemKey не списывает проверки', (meCard2.data?.usage?.checks?.used || 0) === checksAfter, `was=${checksAfter} now=${meCard2.data?.usage?.checks?.used}`);
const free3 = createUser('free');
db.prepare('DELETE FROM product_cards WHERE gtin=?').run(gtin);
const freeExternal = await api(free3.token, 'POST', '/api/product/cards', { codes: [{ code: fullCode(3), gtin }] });
const freeCard = freeExternal.data?.cards?.[0];
ok('FREE: карточка локально без внешних проверок (limits=0)', freeExternal.status === 200 && Array.isArray(freeCard?.card?.warnings) && freeCard.card.warnings.length > 0, JSON.stringify(freeExternal.data?.error || freeCard?.card?.warnings));
idsExtra.push(free3.id);

console.log('\n=== админка тарифов и подписок ===');
const admin = createUser('free', 'admin');
db.prepare('UPDATE users SET totp_enabled=1, totp_secret=? WHERE id=?').run('JBSWY3DPEHPK3PXP', admin.id);
const adminPlans = await api(admin.token, 'GET', '/api/admin/billing/plans');
ok('админ видит тарифы', adminPlans.status === 200 && adminPlans.data?.plans?.length >= 4, JSON.stringify(adminPlans.data?.error));
const savePlan = await api(admin.token, 'POST', '/api/admin/billing/plans', { ...adminPlans.data.plans.find((p) => p.id === 'start'), priceMonthly: 159 });
ok('админ меняет цену тарифа', savePlan.status === 200 && savePlan.data?.plan?.priceMonthly === 159, JSON.stringify(savePlan.data?.error));
await api(admin.token, 'POST', '/api/admin/billing/plans', { ...adminPlans.data.plans.find((p) => p.id === 'start'), priceMonthly: 149 });
const assign = await api(admin.token, 'POST', `/api/admin/billing/user/${free2.id}/assign`, { planId: 'start', days: 30 });
ok('админ назначает START', assign.status === 200, JSON.stringify(assign.data?.error));
const meStart = await api(free2.token, 'GET', '/api/me');
ok('после назначения план START, 500 операций', meStart.data?.plan?.id === 'start' && meStart.data?.usage?.ops?.limit === 500, JSON.stringify(meStart.data?.usage?.ops));
const subs = await api(admin.token, 'GET', '/api/admin/billing/subscriptions?limit=10');
ok('админ видит подписки', subs.status === 200 && Array.isArray(subs.data?.users));
const payments = await api(admin.token, 'GET', '/api/admin/billing/payments');
ok('админ видит платежи', payments.status === 200 && Array.isArray(payments.data?.payments));
const errors = await api(admin.token, 'GET', '/api/admin/billing/errors');
ok('админ видит ошибки интеграций', errors.status === 200 && Array.isArray(errors.data?.failed));
const stats = await api(admin.token, 'GET', '/api/admin/billing/stats');
ok('статистика тарифов', stats.status === 200 && Array.isArray(stats.data?.byPlan));

console.log('\n=== пробный период: окончание ===');
db.prepare("UPDATE users SET trial_ends_at=datetime('now','-1 hour') WHERE id=?").run(free.id);
const { expireSubscriptionsAndTrials } = await import('/opt/code-qr-staging/server/src/lib/subscription.js');
expireSubscriptionsAndTrials();
const meEnded = await api(free.token, 'GET', '/api/me');
ok('после окончания trial план FREE', meEnded.data?.plan?.id === 'free', JSON.stringify(meEnded.data?.plan?.id));
ok('trial_used сохраняется (повторно нельзя)', meEnded.data?.trial?.used === true);

console.log('\n=== ИТОГ ===');
const failed = results.filter((r) => !r.pass);
console.log(`тестов: ${results.length}, пройдено: ${results.length - failed.length}, провалено: ${failed.length}`);
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join('; '));

// cleanup
const ids = [free.id, free2.id, admin.id, ...idsExtra];
for (const id of ids) {
  db.prepare('DELETE FROM usage_events WHERE user_id=?').run(id);
  db.prepare('DELETE FROM usage_periods WHERE user_id=?').run(id);
  db.prepare('DELETE FROM usage_daily WHERE user_id=?').run(id);
  db.prepare('DELETE FROM generation_jobs WHERE user_id=?').run(id);
  db.prepare('DELETE FROM label_templates WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
process.exit(failed.length ? 1 : 0);
