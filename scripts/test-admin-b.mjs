// Тест этапа B: сводка, графики, здоровье сервиса и управление заданиями.
// Запуск: node scripts/test-admin-b.mjs (сервер :3101, тестовая БД)

const BASE = process.env.BASE || 'http://127.0.0.1:3101';

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
};

async function http(method, path, { body, jar } = {}) {
  const h = {
    'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  };
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

const admin = {};
const guest = {};
const email = `analytics-${Date.now()}@test.local`;

console.log('Аналитика этапа B ·', BASE);

let r = await http('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'password123' }, jar: admin });
ok(r.status === 200, 'вход администратора');

r = await http('GET', '/api/admin/overview?days=30', { jar: admin });
ok(r.status === 200 && typeof r.data.revenue.month === 'number', 'сводка отдаёт выручку');
ok(r.data.users.total >= 1 && typeof r.data.money.conversion === 'number', 'клиенты и конверсия посчитаны');
ok(r.data.jobs && typeof r.data.jobs.queue === 'number', 'очередь заданий в сводке');

r = await http('GET', '/api/admin/series?days=14', { jar: admin });
ok(r.status === 200 && r.data.points.length === 14, 'график: 14 точек');
ok(r.data.points.every((p) => 'revenue' in p && 'signups' in p && 'codes' in p), 'в точках есть все метрики');

r = await http('GET', '/api/admin/health', { jar: admin });
ok(r.status === 200 && r.data.uptime > 0, 'аптайм отдаётся');
ok(r.data.dbSize > 0 && typeof r.data.rss === 'number', 'размер БД и память');
ok(r.data.integrations && 'yookassa' in r.data.integrations, 'статусы интеграций');

// Задание и его перезапуск
r = await http('POST', '/api/jobs', {
  jar: admin,
  body: { name: 'B test', mode: 'cz', format: 'png', rows: ['(01)04600000000015(21)5PojkV(91)EE10(92)dGVzdA=='] }
});
ok(r.status === 200, 'задание создано');
const jobId = r.data.job.id;

await new Promise((res) => setTimeout(res, 1500));
r = await http('GET', `/api/admin/jobs/${jobId}`, { jar: admin });
ok(r.status === 200 && ['done', 'running'].includes(r.data.job.status), 'задание видно в админке');
ok(Array.isArray(r.data.items) && r.data.items.length === 1, 'строки задания отдаются');

r = await http('POST', `/api/admin/jobs/${jobId}/retry`, { jar: admin });
ok(r.status === 200 && ['queued', 'running', 'done'].includes(r.data.job.status), 'задание перезапущено');

r = await http('DELETE', `/api/admin/jobs/${jobId}`, { jar: admin });
ok(r.status === 200, 'задание удалено');
r = await http('GET', `/api/admin/jobs/${jobId}`, { jar: admin });
ok(r.status === 404, 'удалённое задание недоступно');

// Обычный клиент не видит аналитику
r = await http('POST', '/api/auth/register', { body: { email, password: 'password123', name: 'Guest' }, jar: guest });
ok(r.status === 200, 'регистрация клиента');
const guestId = r.data.user.id;
r = await http('GET', '/api/admin/overview', { jar: guest });
ok(r.status === 403, 'клиенту закрыта сводка');
r = await http('GET', '/api/admin/health', { jar: guest });
ok(r.status === 403, 'клиенту закрыто здоровье');

r = await http('DELETE', `/api/admin/users/${guestId}`, { body: { confirmEmail: email }, jar: admin });
ok(r.status === 200, 'тестовый клиент удалён');

console.log(`\nИтог: ${passed} прошло, ${failed} провалилось`);
process.exit(failed ? 1 : 0);
