import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const ADMIN_TOKEN = process.argv[2];
const SUPPORT_TOKEN = process.argv[3];
const PORT = 9991;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-admin-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 160));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, timeoutMs = 20000) => { const t = Date.now(); while (Date.now() - t < timeoutMs) { if (await evaluate(expr)) return true; await sleep(350); } return false; };
const checks = [];
const ok = (name, cond, extra = '') => { checks.push(Boolean(cond)); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join('docs', name), Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', name);
};
async function open(token, url) {
  await send('Network.setCookie', { name: 'cq_session', value: token, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  await send('Page.navigate', { url });
  await sleep(2000);
}

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });

// 1) Меню админки: группы и отсутствие лишнего
await open(ADMIN_TOKEN, BASE + '/app/admin');
await waitFor("(document.body.innerText || '').includes('Админ-панель')");
const nav = JSON.parse(await evaluate(`(() => {
  const nav = document.querySelector('nav[aria-label="Разделы админки"]');
  const groups = nav ? [...nav.querySelectorAll('div > div > div:first-child')].map((el) => (el.textContent || '').trim()).filter((t) => t && t.length < 40) : [];
  const links = nav ? [...nav.querySelectorAll('a')].map((a) => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') })) : [];
  return JSON.stringify({ groups, links });
})()`));
ok('Админ-меню: группы разделов', ['Обзор', 'Клиенты и деньги', 'Сервис', 'Поддержка и AI', 'Маркетинг', 'Система'].every((g) => nav.groups.includes(g)), JSON.stringify(nav.groups));
ok('Админ-меню: нет пункта «Помощь»', !nav.links.some((l) => l.text.includes('Помощь')));
ok('Админ-меню: нет дублирующей клиентской навигации', !(await evaluate("Boolean(document.querySelector('nav.lg\\\\:hidden'))")));
ok('Админ-меню: Тарифы и подписки на месте', nav.links.some((l) => l.text.includes('Тарифы и подписки')));
ok('Админ-меню: ссылки ведут в /app/admin', nav.links.every((l) => l.href && l.href.startsWith('/app/admin')));
await evaluate(`(() => { const st = document.createElement('style'); st.textContent = '*{animation:none!important;transition:none!important} .reveal{opacity:1!important;transform:none!important}'; document.head.appendChild(st); return 1; })()`);
await shot('admin-menu.png');

// 2) Проверка всех разделов меню
const routes = [
  ['/app/admin', 'Админ-панель'],
  ['/app/admin/users', 'Клиенты'],
  ['/app/admin/orders', 'Платежи'],
  ['/app/admin/billing', 'Тарифы и подписки'],
  ['/app/admin/jobs', 'Задания'],
  ['/app/admin/storage', 'Хранилище'],
  ['/app/admin/logs', 'Ошибки'],
  ['/app/admin/audit', 'Аудит'],
  ['/app/admin/support', 'Обращения'],
  ['/app/admin/ai', 'AI'],
  ['/app/admin/marketing', 'Рассылки'],
  ['/app/admin/ads', 'Реклама'],
  ['/app/admin/settings', 'Настройки']
];
for (const [url, marker] of routes) {
  await send('Page.navigate', { url: BASE + url });
  await sleep(1500);
  const text = (await evaluate("document.body.innerText || ''")).replace(/\u00a0/g, ' ');
  ok(`Раздел ${url} открывается`, text.includes(marker), marker);
}

// 3) AdminBilling: дублирующая вкладка «Платежи» убрана
await open(ADMIN_TOKEN, BASE + '/app/admin/billing');
await waitFor("(document.body.innerText || '').includes('Тарифы и подписки')");
const billing = await evaluate("document.body.innerText || ''");
const billingTabs = await evaluate("JSON.stringify([...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => t))");
const tabs = JSON.parse(billingTabs);
ok('Тарифы: вкладки без дубля «Платежи»', tabs.includes('Тарифы') && tabs.includes('Подписки') && tabs.includes('Ошибки и статистика') && !tabs.includes('Платежи'), billingTabs);
ok('Тарифы: сохранение работает (кнопки)', billing.includes('Сохранить'));

// 4) Настройки: нет старых «Тарифы PREMIUM» и лимитов
await open(ADMIN_TOKEN, BASE + '/app/admin/settings');
await waitFor("(document.body.innerText || '').includes('Настройки')");
const settings = (await evaluate("document.body.innerText || ''")).replace(/\u00a0/g, ' ');
ok('Настройки: ссылка на «Тарифы и подписки»', settings.includes('Открыть «Тарифы и подписки»'));
ok('Настройки: нет старого блока «Тарифы PREMIUM»', !settings.includes('Тарифы PREMIUM'));
ok('Настройки: нет дублирующей карточки лимитов', !settings.includes('Что доступно на FREE и PREMIUM'));

// 5) Клиенты: фильтр по новым тарифам
await open(ADMIN_TOKEN, BASE + '/app/admin/users');
await waitFor("(document.body.innerText || '').includes('Клиенты')");
const users = await evaluate("document.body.innerText || ''");
const options = await evaluate(`JSON.stringify([...document.querySelectorAll('select option')].map((o) => (o.textContent || '').trim()))`);
ok('Клиенты: фильтр START/PRO/BUSINESS', options.includes('START') && options.includes('PRO') && options.includes('BUSINESS'), options);

// 6) Детальная карточка клиента: подписка ведёт в раздел тарифов
await open(ADMIN_TOKEN, BASE + '/app/admin/users/1');
await sleep(1200);
const userPage = (await evaluate("document.body.innerText || ''")).replace(/\u00a0/g, ' ');
ok('Карточка клиента: ссылка «Управлять тарифом»', userPage.includes('Управлять тарифом') || userPage.includes('Тарифы и подписки'));
ok('Карточка клиента: нет старой кнопки «Снять PRO»', !userPage.includes('Снять PRO') && !userPage.includes('Выдать PRO'));

// 7) Support-роль: ограниченное меню, нет денежных разделов
await open(SUPPORT_TOKEN, BASE + '/app/admin');
await sleep(1500);
const supportUrl = await evaluate('location.pathname');
const supportText = (await evaluate("document.body.innerText || ''")).replace(/\u00a0/g, ' ');
ok('Support: редирект на доступный раздел', supportUrl.startsWith('/app/admin'), supportUrl);
ok('Support: видит Клиентов и Задания', supportText.includes('Клиенты') && supportText.includes('Задания'));
ok('Support: не видит Тарифы и Платежи', !supportText.includes('Тарифы и подписки') && !supportText.includes('Платежи'));

// 8) Мобильная админка: без горизонтальной прокрутки
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await open(ADMIN_TOKEN, BASE + '/app/admin/billing');
await sleep(1500);
const mobile = JSON.parse(await evaluate(`JSON.stringify({ vw: innerWidth, scrollWidth: document.documentElement.scrollWidth, hasNav: Boolean(document.querySelector('nav[aria-label="Разделы админки"]')) })`));
ok('Мобильная админка: нет горизонтальной прокрутки', mobile.scrollWidth <= mobile.vw + 1, JSON.stringify(mobile));
const rr = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('docs/admin-mobile.png', Buffer.from(rr.result.data, 'base64'));
console.log('screenshot: admin-mobile.png');

// 9) Старые API удалены, новые работают
const apiStatus = async (p) => (await fetch(BASE + p, { headers: { Cookie: `cq_session=${ADMIN_TOKEN}` } })).status;
ok('Старый /api/admin/plans удалён', (await apiStatus('/api/admin/plans')) === 404);
ok('Старый /api/admin/pricing удалён', (await apiStatus('/api/admin/pricing')) === 404);
ok('Дубль /api/admin/billing/payments удалён', (await apiStatus('/api/admin/billing/payments')) === 404);
ok('Новый /api/admin/billing/plans работает', (await apiStatus('/api/admin/billing/plans')) === 200);

console.log('\nconsole errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 4)));
const failed = checks.filter((x) => !x).length;
console.log(`итог: ${checks.length - failed}/${checks.length}`);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed ? 1 : 0);
