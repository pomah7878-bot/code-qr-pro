// Тест этапа A админки: клиенты, блокировка, сброс пароля, ручные операции с заказами.
// Запуск: node scripts/test-admin-a.mjs
// Требует запущенный сервер на :3101 с тестовой БД (см. README).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://127.0.0.1:3101';
const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../server/data/test-admin.db', import.meta.url));
const require = createRequire(new URL('../server/package.json', import.meta.url));

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
};

async function http(method, path, { body, jar } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (jar?.cookie) headers.Cookie = jar.cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const session = set.find((c) => c.startsWith('cq_session='));
  if (jar && session) jar.cookie = session.split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const admin = {};
const client = {};
const stamp = Date.now();
const clientEmail = `client-${stamp}@test.local`;

console.log('Админ этапа A ·', BASE);

// 1. Админ
let r = await http('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'password123' }, jar: admin });
if (r.status !== 200) {
  r = await http('POST', '/api/auth/register', { body: { email: 'admin@test.local', password: 'password123', name: 'Admin' }, jar: admin });
}
ok(r.status === 200 && r.data.user?.role === 'admin', 'вход администратора');
ok(!admin.cookie?.includes('undefined'), 'сессия администратора получена');

// 2. Клиент
r = await http('POST', '/api/auth/register', { body: { email: clientEmail, password: 'password123', name: 'Тестовый клиент' }, jar: client });
ok(r.status === 200, 'регистрация тестового клиента');
const clientId = r.data.user?.id;
ok(Number.isFinite(clientId), 'id клиента получен');

// 3. Доступ: клиент не может в админку
r = await http('GET', '/api/admin/users', { jar: client });
ok(r.status === 403, 'клиенту закрыт /api/admin/users');

// 4. Поиск и карточка
r = await http('GET', '/api/admin/users?q=' + encodeURIComponent(clientEmail), { jar: admin });
ok(r.status === 200 && r.data.total === 1 && r.data.users[0].id === clientId, 'поиск клиента по email');
ok(r.data.users[0].status === 'active', 'новый клиент активен');

r = await http('GET', `/api/admin/users/${clientId}`, { jar: admin });
ok(r.status === 200 && r.data.user.email === clientEmail, 'карточка клиента открывается');
ok(Array.isArray(r.data.sessions) && r.data.sessions.length === 1, 'в карточке видна активная сессия');

// 5. Выдача PREMIUM на 90 дней
r = await http('POST', `/api/admin/users/${clientId}/grant`, { body: { days: 90 }, jar: admin });
ok(r.status === 200 && r.data.user.plan === 'premium', 'PREMIUM выдан');
const until = new Date(String(r.data.premiumUntil).replace(' ', 'T') + 'Z');
const daysLeft = Math.round((until.getTime() - Date.now()) / 86400000);
ok(daysLeft >= 89 && daysLeft <= 91, `срок PREMIUM ≈ 90 дней (${daysLeft})`);

r = await http('GET', '/api/me', { jar: client });
ok(r.data.plan?.id === 'premium', 'клиент видит PREMIUM');

// 6. Блокировка
r = await http('POST', `/api/admin/users/${clientId}/block`, { body: { reason: 'тест' }, jar: admin });
ok(r.status === 200 && r.data.user.status === 'blocked', 'клиент заблокирован');
r = await http('GET', '/api/me', { jar: client });
ok(r.status === 401, 'сессия заблокированного завершена');
r = await http('POST', '/api/auth/login', { body: { email: clientEmail, password: 'password123' }, jar: {} });
ok(r.status === 403, 'вход заблокированному запрещён');

// 7. Разблокировка и вход
r = await http('POST', `/api/admin/users/${clientId}/unblock`, { jar: admin });
ok(r.status === 200 && r.data.user.status === 'active', 'клиент разблокирован');
r = await http('POST', '/api/auth/login', { body: { email: clientEmail, password: 'password123' }, jar: client });
ok(r.status === 200, 'вход после разблокировки');

// 8. Сброс пароля и принудительная смена
r = await http('POST', `/api/admin/users/${clientId}/password-reset`, { jar: admin });
ok(r.status === 200 && typeof r.data.password === 'string' && r.data.password.length === 12, 'выдан временный пароль');
const tempPassword = r.data.password;
r = await http('GET', '/api/me', { jar: client });
ok(r.status === 401, 'старая сессия после сброса закрыта');
r = await http('POST', '/api/auth/login', { body: { email: clientEmail, password: tempPassword }, jar: client });
ok(r.status === 200 && r.data.user.mustChangePassword === true, 'вход по временному паролю с флагом смены');
r = await http('GET', '/api/jobs', { jar: client });
ok(r.status === 428, 'до смены пароля кабинет закрыт (428)');
r = await http('POST', '/api/auth/password', { body: { currentPassword: tempPassword, newPassword: 'newpassword456' }, jar: client });
ok(r.status === 200, 'пароль сменён');
r = await http('GET', '/api/jobs', { jar: client });
ok(r.status === 200, 'после смены пароля кабинет доступен');

// 9. Ручное подтверждение заказа (заказ кладём в БД — ЮKassa в тесте не настроена)
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);
const insertOrder = (status, externalId = null) => db.prepare(
  "INSERT INTO orders (user_id, plan, amount, days, status, external_id) VALUES (?, 'premium', 1990, 30, ?, ?)"
).run(clientId, status, externalId);

let info = insertOrder('pending');
const confirmOrderId = info.lastInsertRowid;
r = await http('POST', `/api/admin/orders/${confirmOrderId}/confirm`, { jar: admin });
ok(r.status === 200 && r.data.order.status === 'paid' && r.data.order.paid_at, 'заказ подтверждён вручную');
r = await http('GET', `/api/admin/users/${clientId}`, { jar: admin });
ok(r.data.user.plan === 'premium', 'после подтверждения клиент на PREMIUM');

info = insertOrder('pending');
const cancelOrderId = info.lastInsertRowid;
r = await http('POST', `/api/admin/orders/${cancelOrderId}/cancel`, { jar: admin });
ok(r.status === 200 && r.data.order.status === 'canceled', 'заказ отменён');

r = await http('POST', `/api/admin/orders/${cancelOrderId}/recheck`, { jar: admin });
ok(r.status === 400, 'повторная проверка отменённого заказа отклонена');

// 10. Экспорт CSV
r = await http('GET', '/api/admin/users/export.csv', { jar: admin });
ok(r.status === 200 && String(r.data).includes('ID;Email'), 'CSV клиентов отдаётся');
r = await http('GET', '/api/admin/orders/export.csv', { jar: admin });
ok(r.status === 200 && String(r.data).includes('Email'), 'CSV платежей отдаётся');

// 11. Удаление клиента
r = await http('DELETE', `/api/admin/users/${clientId}`, { body: { confirmEmail: 'wrong@test.local' }, jar: admin });
ok(r.status === 400, 'удаление без верного email отклонено');
r = await http('DELETE', `/api/admin/users/${clientId}`, { body: { confirmEmail: clientEmail }, jar: admin });
ok(r.status === 200, 'клиент удалён');
r = await http('GET', `/api/admin/users/${clientId}`, { jar: admin });
ok(r.status === 404, 'карточка удалённого клиента недоступна');
r = await http('POST', '/api/auth/login', { body: { email: clientEmail, password: 'newpassword456' }, jar: {} });
ok(r.status === 401, 'вход удалённого клиента невозможен');

// 12. Защита от самоблокировки и удаления себя
r = await http('POST', '/api/admin/users/1/block', { body: { reason: 'test' }, jar: admin });
ok(r.status === 400, 'нельзя заблокировать себя');

db.close();
console.log(`\nИтог: ${passed} прошло, ${failed} провалилось`);
process.exit(failed ? 1 : 0);
