import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

const BASE = 'https://code-qr.stockcity.ru';
const DB_PATH = '/opt/code-qr/server/data/app.db';
const db = new Database(DB_PATH);
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: Boolean(cond) });
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`);
};

function createUser(plan = 'free', role = 'user', totp = false) {
  const email = `qa-prod-${Date.now()}-${randomBytes(3).toString('hex')}@example.com`;
  const token = 'p' + randomBytes(24).toString('hex');
  const id = db.prepare("INSERT INTO users (email, password_hash, name, role, plan, totp_enabled, totp_secret) VALUES (?, 'x', 'QA prod', ?, ?, ?, ?)")
    .run(email, role, plan, totp ? 1 : 0, totp ? 'JBSWY3DPEHPK3PXP' : null).lastInsertRowid;
  db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .run(token, randomBytes(8).toString('hex'), id, new Date(Date.now() + 86400000).toISOString(), '127.0.0.1', 'qa-prod');
  if (plan !== 'free') {
    const sqlNow = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
    db.prepare("INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at, source) VALUES (?,?, 'active', 'qa', ?, ?, 'admin')")
      .run(id, plan, sqlNow(new Date()), sqlNow(new Date(Date.now() + 30 * 86400000)));
  }
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
const code = (i) => `(01)${gtin}(21)QAP${String(i).padStart(4, '0')}(91)EE12(92)${'B'.repeat(12)}${i}`;
const gs1 = (i) => `(01)${gtin}(21)QAP${String(i).padStart(4, '0')}`;
const template = { name: 'QA prod 58x40', widthMm: 58, heightMm: 40, dpi: 203, elements: [{ id: 'dm', type: 'datamatrix', x: 2, y: 2, w: 18, h: 18 }] };
const ids = [];

console.log('=== публичные данные ===');
const plans = await fetch(BASE + '/api/plans').then((r) => r.json());
ok('/api/plans: 4 тарифа', Array.isArray(plans.list) && plans.list.length >= 4, `list=${plans.list?.length}`);
const freePlan = plans.list.find((p) => p.id === 'free');
ok('FREE: 600/20/0', freePlan.opsPerPeriod === 600 && freePlan.dailyOps === 20 && freePlan.checksPerPeriod === 0);
const page = await fetch(BASE + '/pricing').then((r) => r.text());
ok('Страница /pricing отдаётся', page.includes('CODE QR PRO'));
const home = await fetch(BASE + '/').then((r) => r.text());
ok('Главная отдаётся', home.includes('CODE QR PRO'));

console.log('\n=== free + trial ===');
const free = createUser('free'); ids.push(free.id);
let me = await api(free.token, 'GET', '/api/me');
ok('/api/me: free + usage', me.data?.plan?.id === 'free' && me.data?.usage?.ops?.limit === 600 && me.data?.usage?.daily?.limit === 20);
const trial = await api(free.token, 'POST', '/api/billing/trial');
ok('trial активирован', trial.status === 200 && trial.data?.trial?.active, JSON.stringify(trial.data?.error));
me = await api(free.token, 'GET', '/api/me');
ok('trial = PRO, 50 проверок', me.data?.plan?.id === 'pro' && me.data?.usage?.checks?.limit === 50);
const trial2 = await api(free.token, 'POST', '/api/billing/trial');
ok('повторный trial 409', trial2.status === 409);

console.log('\n=== генерация, лимиты, идемпотентность ===');
const free2 = createUser('free'); ids.push(free2.id);
const tooMany = await api(free2.token, 'POST', '/api/jobs', { mode: 'gs1', format: 'png', rows: Array.from({ length: 21 }, (_, i) => gs1(i)) });
ok('FREE: 21 строка → 400', tooMany.status === 400 && /Пакет больше лимита/.test(tooMany.data?.error || ''));
const job = await api(free2.token, 'POST', '/api/jobs', { mode: 'gs1', format: 'png', rows: Array.from({ length: 5 }, (_, i) => gs1(i)) }, { 'X-Idempotency-Key': 'prod-idem-1' });
ok('FREE: 5 кодов генерация', job.status === 200 && job.data?.job?.valid === 5, JSON.stringify(job.data?.error));
const job2 = await api(free2.token, 'POST', '/api/jobs', { mode: 'gs1', format: 'png', rows: Array.from({ length: 5 }, (_, i) => gs1(i)) }, { 'X-Idempotency-Key': 'prod-idem-1' });
const me2 = await api(free2.token, 'GET', '/api/me');
ok('идемпотентность: тот же job', job2.data?.job?.id === job.data?.job?.id, `id1=${job.data?.job?.id} id2=${job2.data?.job?.id}`);
ok('идемпотентность: 5 операций', me2.data?.usage?.ops?.used === 5, `used=${me2.data?.usage?.ops?.used}`);

console.log('\n=== PDF и лимит ===');
const pdf = await api(free2.token, 'POST', '/api/labels/pdf/ticket', { template, rows: Array.from({ length: 3 }, () => ({ code: gs1(1), gtin, serial: 'QAP0001' })), single: true, source: 'reprint', idemKey: 'prod-pdf-1' });
ok('PDF 3 этикетки', pdf.status === 200 && Boolean(pdf.data?.url), JSON.stringify(pdf.data?.error));
const mePdf = await api(free2.token, 'GET', '/api/me');
ok('PDF списал 3 операции', mePdf.data?.usage?.daily?.used === 8, `daily=${mePdf.data?.usage?.daily?.used}`);
const pdfFile = pdf.data?.url ? await fetch(BASE + pdf.data.url, { headers: { Cookie: `cq_session=${free2.token}` } }) : null;
ok('PDF файл скачивается', Boolean(pdfFile && pdfFile.ok), `status=${pdfFile?.status}`);

console.log('\n=== расширенная проверка DataMatrix ===');
const pro = createUser('pro'); ids.push(pro.id);
db.prepare('DELETE FROM product_cards WHERE gtin=?').run(gtin);
const card = await api(pro.token, 'POST', '/api/product/cards', { codes: [{ code: code(1), gtin }], idemKey: 'prod-card-1' });
const c = card.data?.cards?.[0];
ok('PRO: карточка получена', card.status === 200 && c?.ok, JSON.stringify(card.data?.error));
ok('карточка: источник и поля', Boolean(c?.card?.source) && Boolean(c?.code?.gtin), JSON.stringify({ source: c?.card?.source, name: c?.card?.name }));
const meCard = await api(pro.token, 'GET', '/api/me');
ok('PRO: проверка списана', (meCard.data?.usage?.checks?.used || 0) > 0, `checks=${meCard.data?.usage?.checks?.used}`);
const cardDup = await api(pro.token, 'POST', '/api/product/cards', { codes: [{ code: code(1), gtin }], idemKey: 'prod-card-1' });
const meCard2 = await api(pro.token, 'GET', '/api/me');
ok('повтор idemKey не списывает', (meCard2.data?.usage?.checks?.used || 0) === (meCard.data?.usage?.checks?.used || 0));

console.log('\n=== AI-помощник (бесплатная модель) ===');
const ai = await api(free.token, 'POST', '/api/assistant/chat', { page: 'billing', message: 'Какие лимиты у FREE?' });
ok('AI отвечает на FREE (базовый)', ai.status === 200 && (ai.data?.answer || '').length > 20, `status=${ai.status} model=${ai.data?.model || ''}`);

console.log('\n=== админка ===');
const admin = createUser('free', 'admin', true); ids.push(admin.id);
const aPlans = await api(admin.token, 'GET', '/api/admin/billing/plans');
ok('админ: тарифы', aPlans.status === 200 && aPlans.data?.plans?.length >= 4, JSON.stringify(aPlans.data?.error));
const startPlan = aPlans.data?.plans?.find((p) => p.id === 'start');
const save = await api(admin.token, 'POST', '/api/admin/billing/plans', { ...startPlan, priceMonthly: 149 });
ok('админ: сохранение тарифа', save.status === 200 && save.data?.plan?.priceMonthly === 149);
const assign = await api(admin.token, 'POST', `/api/admin/billing/user/${free2.id}/assign`, { planId: 'start', days: 30 });
ok('админ: назначение START', assign.status === 200, JSON.stringify(assign.data?.error));
const meStart = await api(free2.token, 'GET', '/api/me');
ok('после назначения START', meStart.data?.plan?.id === 'start' && meStart.data?.usage?.ops?.limit === 500, `ops=${meStart.data?.usage?.ops?.limit}`);
const subs = await api(admin.token, 'GET', '/api/admin/billing/subscriptions?query=qa-prod&limit=20');
ok('админ: список подписок', subs.status === 200 && Array.isArray(subs.data?.users));
const pays = await api(admin.token, 'GET', '/api/admin/billing/payments?limit=5');
ok('админ: платежи', pays.status === 200 && Array.isArray(pays.data?.payments));
const errs = await api(admin.token, 'GET', '/api/admin/billing/errors');
ok('админ: ошибки интеграций', errs.status === 200 && Array.isArray(errs.data?.failed));
const stats = await api(admin.token, 'GET', '/api/admin/billing/stats');
ok('админ: статистика', stats.status === 200 && Array.isArray(stats.data?.byPlan));

console.log('\n=== биллинг: цены и подписка ===');
const checkoutPage = await api(pro.token, 'GET', '/api/billing/subscription');
ok('/api/billing/subscription отдаёт план/usage/тарифы', checkoutPage.status === 200 && checkoutPage.data?.plan?.id === 'pro' && Array.isArray(checkoutPage.data?.plans));
const promo = await api(pro.token, 'POST', '/api/billing/promo/check', { planId: 'pro', period: 'month', code: '' });
ok('цена PRO месяц = 349', promo.status === 200 && promo.data?.finalAmount === 349, JSON.stringify(promo.data));
const promoYear = await api(pro.token, 'POST', '/api/billing/promo/check', { planId: 'pro', period: 'year', code: '' });
ok('цена PRO год = 3490', promoYear.data?.finalAmount === 3490, JSON.stringify(promoYear.data?.finalAmount));

console.log('\n=== существующие функции ===');
const legacy = await api(pro.token, 'POST', '/api/cz/verify', { codes: [code(1)] });
ok('/api/cz/verify работает', legacy.status === 200 && (legacy.data?.results || []).length === 1, JSON.stringify(legacy.data).slice(0, 120));
const genPage = await fetch(BASE + '/app/generate').then((r) => r.text());
ok('страница генерации отдаётся', genPage.includes('CODE QR PRO'));

console.log('\n=== ИТОГ ===');
const failed = results.filter((r) => !r.pass);
console.log(`тестов: ${results.length}, пройдено: ${results.length - failed.length}, провалено: ${failed.length}`);
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join('; '));

for (const id of ids) {
  db.prepare('DELETE FROM usage_events WHERE user_id=?').run(id);
  db.prepare('DELETE FROM usage_periods WHERE user_id=?').run(id);
  db.prepare('DELETE FROM usage_daily WHERE user_id=?').run(id);
  db.prepare('DELETE FROM generation_jobs WHERE user_id=?').run(id);
  db.prepare('DELETE FROM label_templates WHERE user_id=?').run(id);
  db.prepare('DELETE FROM support_tickets WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
process.exit(failed.length ? 1 : 0);
