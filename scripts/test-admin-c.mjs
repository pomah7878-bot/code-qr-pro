// Тест этапа C: 2FA, аудит, роли поддержки, CSRF, метаданные сессий.
// Запуск: node scripts/test-admin-c.mjs (сервер :3101, тестовая БД)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { totpNow } from '../server/src/lib/totp.js';

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
  // уникальный IP на запрос: обходим лимит 10 входов/мин при последовательных прогонах тестов
  if (!h['X-Forwarded-For']) {
    h['X-Forwarded-For'] = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  }
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

// Начинаем с выключенной 2FA у тестового администратора
const db = new Database(DB_PATH);
db.prepare("UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup='[]' WHERE email='admin@test.local'").run();

const admin = {};
console.log('Безопасность этапа C ·', BASE);

let r = await http('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'password123' }, jar: admin });
ok(r.status === 200 && !r.data.twoFactor, 'вход без 2FA');

// CSRF
r = await http('POST', '/api/auth/login', {
  body: { email: 'admin@test.local', password: 'password123' },
  headers: { Origin: 'https://evil.example' }
});
ok(r.status === 403, 'запрос с чужого Origin отклонён');
r = await http('POST', '/api/auth/login', {
  body: { email: 'admin@test.local', password: 'password123' },
  headers: { Origin: BASE }
});
ok(r.status === 200, 'запрос со своего Origin проходит');

// Настройка 2FA
r = await http('POST', '/api/auth/2fa/setup', { jar: admin });
ok(r.status === 200 && typeof r.data.secret === 'string' && r.data.secret.length >= 16, 'секрет 2FA выдан');
ok(String(r.data.qr).startsWith('data:image/png;base64,'), 'QR отрисован');
const secret = r.data.secret;

r = await http('POST', '/api/auth/2fa/enable', { body: { code: '000000' }, jar: admin });
ok(r.status === 400, 'неверный код не включает 2FA');

r = await http('POST', '/api/auth/2fa/enable', { body: { code: totpNow(secret) }, jar: admin });
ok(r.status === 200 && Array.isArray(r.data.backupCodes) && r.data.backupCodes.length === 10, '2FA включена, выданы 10 резервных кодов');
const backup = r.data.backupCodes;

r = await http('GET', '/api/me', { jar: admin });
ok(r.data.user.twoFactorEnabled === true, '/api/me показывает включённую 2FA');

// Вход с 2FA
const second = {};
r = await http('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'password123' }, jar: second });
ok(r.status === 200 && r.data.twoFactor === true && r.data.ticket, 'пароль принят, требуется код');
ok(!second.cookie, 'сессия до ввода кода не выдаётся');
const ticket = r.data.ticket;

r = await http('POST', '/api/auth/2fa/challenge', { body: { ticket, code: '111111' }, jar: second });
ok(r.status === 401, 'неверный код отклонён');

r = await http('POST', '/api/auth/2fa/challenge', { body: { ticket, code: totpNow(secret) }, jar: second });
ok(r.status === 200 && r.data.user?.email === 'admin@test.local', 'вход по коду 2FA');
ok(Boolean(second.cookie), 'сессия выдана после кода');

r = await http('GET', '/api/me', { jar: second });
ok(r.status === 200 && r.data.user.twoFactorEnabled === true, 'новая сессия работает');

// Резервный код одноразовый
const third = {};
r = await http('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'password123' }, jar: third });
const ticket2 = r.data.ticket;
r = await http('POST', '/api/auth/2fa/challenge', { body: { ticket: ticket2, code: backup[0] }, jar: third });
ok(r.status === 200, 'вход по резервному коду');
const fourth = {};
r = await http('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'password123' }, jar: fourth });
r = await http('POST', '/api/auth/2fa/challenge', { body: { ticket: r.data.ticket, code: backup[0] }, jar: fourth });
ok(r.status === 401, 'использованный резервный код не работает');

// Метаданные сессии
const adminId = r.data?.user?.id || 1;
r = await http('GET', `/api/admin/users/${adminId}`, { jar: second });
ok(r.status === 200 && r.data.sessions.length > 0 && Boolean(r.data.sessions[0].ip), 'в сессии сохранён IP');
ok(String(r.data.sessions[0].user_agent || '').length > 0, 'в сессии сохранён User-Agent');

// Отключение 2FA
r = await http('POST', '/api/auth/2fa/disable', { body: { password: 'wrong', code: totpNow(secret) }, jar: second });
ok(r.status === 400, 'отключение с неверным паролем отклонено');
r = await http('POST', '/api/auth/2fa/disable', { body: { password: 'password123', code: totpNow(secret) }, jar: second });
ok(r.status === 200, '2FA отключена');
r = await http('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'password123' }, jar: {} });
ok(r.status === 200 && !r.data.twoFactor, 'вход снова без кода');

// Журнал аудита
r = await http('GET', '/api/admin/audit?action=2fa', { jar: second });
ok(r.status === 200 && r.data.total >= 3, 'аудит 2FA записан');
ok(r.data.entries.some((e) => e.action === '2fa.enable'), 'запись о включении 2FA');
ok(r.data.entries.some((e) => e.action === '2fa.disable'), 'запись об отключении 2FA');

// Роль поддержки: только чтение клиентов и заданий
const supportEmail = `support-${Date.now()}@test.local`;
const support = {};
r = await http('POST', '/api/auth/register', { body: { email: supportEmail, password: 'password123', name: 'Support' }, jar: support });
const supportId = r.data.user.id;
r = await http('POST', `/api/admin/users/${supportId}/role`, { body: { role: 'support' }, jar: second });
ok(r.status === 200 && r.data.user.role === 'support', 'роль support выдана');

r = await http('GET', '/api/admin/users?q=' + encodeURIComponent(supportEmail), { jar: support });
ok(r.status === 200, 'support видит клиентов');
r = await http('GET', '/api/admin/jobs', { jar: support });
ok(r.status === 200, 'support видит задания');
r = await http('GET', '/api/admin/orders', { jar: support });
ok(r.status === 403, 'support не видит платежи');
r = await http('GET', '/api/admin/overview', { jar: support });
ok(r.status === 403, 'support не видит выручку');
r = await http('GET', '/api/admin/audit', { jar: support });
ok(r.status === 403, 'support не видит журнал');
r = await http('POST', `/api/admin/users/${adminId}/grant`, { body: { days: 30 }, jar: support });
ok(r.status === 403, 'support не может выдавать PREMIUM');

// Удаление тестового сотрудника
r = await http('DELETE', `/api/admin/users/${supportId}`, { body: { confirmEmail: supportEmail }, jar: second });
ok(r.status === 200, 'тестовый сотрудник удалён');

db.close();
console.log(`\nИтог: ${passed} прошло, ${failed} провалилось`);
process.exit(failed ? 1 : 0);
