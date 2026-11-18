// Тест этапа D: промокоды, скидка в заказе, лимиты тарифов, SMTP и рассылки.
// Запуск: node scripts/test-admin-d.mjs (сервер :3101, тестовая БД)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { unsubscribeToken } from '../server/src/lib/mailer.js';

const BASE = process.env.BASE || 'http://127.0.0.1:3101';
const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../server/data/test-admin.db', import.meta.url));
const require = createRequire(new URL('../server/package.json', import.meta.url));
const Database = require('better-sqlite3');

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
};

async function http(method, path, { body, jar, headers = {} } = {}) {
  const h = { ...headers };
  if (body) h['Content-Type'] = 'application/json';
  if (jar?.cookie) h.Cookie = jar.cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const session = set.find((c) => c.startsWith('cq_session='));
  if (jar && session) jar.cookie = session.split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const db = new Database(DB_PATH);
db.prepare("DELETE FROM app_settings WHERE key='plan_limits'").run();
db.prepare("DELETE FROM app_settings WHERE key LIKE 'smtp_%'").run();
const admin = {};
const client = {};
const stamp = Date.now();
const clientEmail = `promo-${stamp}@test.local`;
const promoCode = 'D' + stamp.toString(36).toUpperCase();

console.log('Монетизация этапа D ·', BASE);

let r = await http('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'password123' }, jar: admin });
ok(r.status === 200, 'вход администратора');

r = await http('POST', '/api/auth/register', { body: { email: clientEmail, password: 'password123', name: 'Promo Client' }, jar: client });
const clientId = r.data.user.id;
ok(r.status === 200, 'регистрация клиента');

// Базовая цена периода
const plans = (await http('GET', '/api/plans')).data.plans;
const premium = plans.find((p) => p.id === 'premium');
const offer = premium.offers[0];
const basePrice = offer.finalPrice;
const days = offer.days;

// Промокод
r = await http('POST', '/api/admin/promo', {
  jar: admin,
  body: { code: promoCode, kind: 'percent', value: 20, maxUses: 5, perUserLimit: 1, active: true, note: 'тест' }
});
ok(r.status === 200 && r.data.promo.code === promoCode, 'промокод создан');
const promoId = r.data.promo.id;

r = await http('POST', '/api/admin/promo', { jar: admin, body: { code: promoCode, kind: 'percent', value: 20 } });
ok(r.status === 409, 'дубль кода отклонён');

r = await http('POST', '/api/admin/promo', { jar: admin, body: { code: 'x', kind: 'percent', value: 20 } });
ok(r.status === 400, 'короткий код отклонён');

// Проверка кода клиентом
r = await http('POST', '/api/billing/promo/check', { jar: client, body: { code: promoCode, days } });
const expected = Math.round(basePrice * 0.8 * 100) / 100;
ok(r.status === 200 && r.data.finalAmount === expected, `скидка 20% применена (${r.data.finalAmount} ₽)`);
ok(r.data.discount === Math.round(basePrice * 0.2 * 100) / 100, 'сумма скидки верна');

r = await http('POST', '/api/billing/promo/check', { jar: client, body: { code: 'NOPE-' + stamp, days } });
ok(r.status === 400, 'неизвестный код отклонён');

// Ручное подтверждение заказа с промокодом погашает его
const info = db.prepare(`INSERT INTO orders (user_id, plan, amount, days, status, promo_code, discount)
  VALUES (?, 'premium', ?, ?, 'pending', ?, ?)`).run(clientId, expected, days, promoCode, basePrice - expected);
const orderId = info.lastInsertRowid;
r = await http('POST', `/api/admin/orders/${orderId}/confirm`, { jar: admin });
ok(r.status === 200 && r.data.order.status === 'paid', 'заказ с промокодом подтверждён');
const promoRow = db.prepare('SELECT * FROM promo_codes WHERE id=?').get(promoId);
ok(promoRow.used_count === 1, 'погашение учтено');
const redemption = db.prepare('SELECT COUNT(*) c FROM promo_redemptions WHERE promo_id=? AND order_id=?').get(promoId, orderId).c;
ok(redemption === 1, 'погашение записано один раз');

r = await http('POST', '/api/billing/promo/check', { jar: client, body: { code: promoCode, days } });
ok(r.status === 400, 'повторное использование запрещено лимитом на клиента');

// Лимиты тарифов
r = await http('GET', '/api/admin/plans', { jar: admin });
ok(r.status === 200 && r.data.free.codesPerDay === 50, 'лимиты по умолчанию');

r = await http('PUT', '/api/admin/plans', {
  jar: admin,
  body: {
    plans: {
      free: { ...r.data.free, codesPerDay: 77 },
      premium: { ...r.data.premium, codesPerDay: 4321 }
    }
  }
});
ok(r.status === 200 && r.data.free.codesPerDay === 77, 'лимит FREE изменён');

r = await http('GET', '/api/me', { jar: client });
ok(r.data.plan.codesPerDay === 4321, 'новый лимит PREMIUM действует у клиента');

const broken = await http('PUT', '/api/admin/plans', {
  jar: admin,
  body: { plans: { free: { ...r.data.plan, codesPerDay: 0 } } }
});
ok(broken.status === 400, 'некорректный лимит отклонён');

// SMTP
r = await http('GET', '/api/admin/settings/smtp', { jar: admin });
ok(r.status === 200 && r.data.configured === false, 'SMTP изначально не настроен');

r = await http('PUT', '/api/admin/settings/smtp', {
  jar: admin,
  body: {
    host: 'smtp.test.local', port: 2525, secure: false, user: 'mailer', pass: 'secret',
    fromName: 'CODE QR PRO', fromEmail: 'noreply@test.local'
  }
});
ok(r.status === 200 && r.data.configured === true, 'SMTP сохранён');

r = await http('GET', '/api/admin/settings/smtp', { jar: admin });
ok(r.data.hasPassword === true && !('pass' in r.data), 'пароль не отдаётся наружу');

// Предпросмотр рассылки
r = await http('POST', '/api/admin/email/preview', {
  jar: admin,
  body: { segment: 'all', subject: 'Тестовая рассылка', body: 'Привет! Это тестовое письмо.' }
});
const totalBefore = r.data.total;
ok(r.status === 200 && totalBefore >= 2, 'предпросмотр видит получателей');
ok(String(r.data.html).includes('тестовое письмо'), 'текст попал в письмо');

// Отписка
const token = unsubscribeToken(clientId);
r = await http('GET', '/api/email/unsubscribe?t=' + encodeURIComponent(token));
ok(r.status === 200, 'страница отписки открывается');
ok(db.prepare('SELECT email_opt_out FROM users WHERE id=?').get(clientId).email_opt_out === 1, 'отписка сохранена');

r = await http('POST', '/api/admin/email/preview', { jar: admin, body: { segment: 'all', subject: 'x', body: 'y' } });
ok(r.data.total === totalBefore - 1, 'отписавшийся исключён из сегмента');

r = await http('GET', '/api/email/unsubscribe?t=broken');
ok(r.status === 400, 'битая ссылка отписки отклонена');

// Изменение и удаление промокода
r = await http('PUT', `/api/admin/promo/${promoId}`, {
  jar: admin,
  body: { code: promoCode, kind: 'percent', value: 25, maxUses: 5, perUserLimit: 1, active: false }
});
ok(r.status === 200 && r.data.promo.value === 25 && r.data.promo.active === false, 'промокод изменён и выключен');

r = await http('DELETE', `/api/admin/promo/${promoId}`, { jar: admin });
ok(r.status === 200, 'промокод удалён');

r = await http('GET', '/api/admin/audit?action=promo', { jar: admin });
ok(r.status === 200 && r.data.total >= 3, 'действия с промокодами в журнале');

// Уборка
r = await http('DELETE', `/api/admin/users/${clientId}`, { body: { confirmEmail: clientEmail }, jar: admin });
ok(r.status === 200, 'тестовый клиент удалён');

db.close();
console.log(`\nИтог: ${passed} прошло, ${failed} провалилось`);
process.exit(failed ? 1 : 0);
