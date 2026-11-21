import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const PORT = 10131;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-seo-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1300', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 140));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, timeoutMs = 25000) => { const t = Date.now(); while (Date.now() - t < timeoutMs) { if (await ev(expr)) return true; await sleep(300); } return false; };
const checks = [];
const ok = (name, cond, extra = '') => { checks.push(Boolean(cond)); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };

await send('Runtime.enable'); await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

const before = await (await fetch(BASE + '/api/admin/analytics/dashboard?days=30', { headers: { Cookie: 'cq_session=' + TOKEN } })).json();

await send('Page.navigate', { url: BASE + '/app/admin/analytics' });
await waitFor("(document.body.innerText || '').includes('SEO и аналитика')");
await sleep(2500);
const page = JSON.parse(await ev(`(() => JSON.stringify({
  title: [...document.querySelectorAll('h1,h2')].map((h) => h.textContent.trim()).find((t) => t.includes('SEO и аналитика')) || '',
  kpiCards: [...document.querySelectorAll('.font-display.font-extrabold.text-2xl')].map((x) => x.textContent.trim()).slice(0, 8),
  chart: document.querySelectorAll('svg').length,
  seoScore: document.body.innerText.includes('/100'),
  checks: document.querySelectorAll('svg').length,
  webmasterCard: document.body.innerText.includes('Яндекс.Вебмастер'),
  nav: [...document.querySelectorAll('nav[aria-label="Разделы админки"] a')].some((a) => (a.textContent || '').includes('SEO и аналитика')),
  hasRows: document.body.innerText.includes('Топ страниц') && document.body.innerText.includes('Источники трафика'),
  bots: document.body.innerText.includes('Индексация: поисковые роботы')
}))()`));
console.log('page:', JSON.stringify(page));
ok('Страница SEO и аналитика открывается', page.title.includes('SEO'), page.title);
ok('KPI-карточки отображаются', page.kpiCards.length >= 6, JSON.stringify(page.kpiCards));
ok('График трафика на месте', page.chart >= 2);
ok('SEO-оценка и чек-лист', page.seoScore === true);
ok('Источники и топ страниц', page.hasRows === true);
ok('Блок индексации ботами', page.bots === true);
ok('Пункт меню есть', page.nav === true);

// live tracker: посещаем публичную страницу и проверяем прирост просмотров
await send('Page.navigate', { url: BASE + '/faq' });
await sleep(2200);
await send('Page.navigate', { url: BASE + '/articles' });
await sleep(2200);
await sleep(1200);
const after = await (await fetch(BASE + '/api/admin/analytics/dashboard?days=30', { headers: { Cookie: 'cq_session=' + TOKEN } })).json();
ok('Трекер фиксирует новые просмотры', Number(after.kpi.pageviews) > Number(before.kpi.pageviews), `${before.kpi.pageviews} → ${after.kpi.pageviews}`);

// невалидный токен Вебмастера: ошибка, но настройка не сохраняется
await send('Page.navigate', { url: BASE + '/app/admin/analytics' });
await sleep(2200);
await ev(`(() => { const i=document.querySelector('input[type=password]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'invalid-qa-token'); i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
await sleep(300);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').trim().startsWith('Подключить')); if(b)b.click(); return 1; })()`);
await waitFor("(document.body.innerText || '').includes('Вебмастер: HTTP') || (document.body.innerText || '').includes('невалид')", 15000);
const wm = await (await fetch(BASE + '/api/admin/analytics/webmaster', { headers: { Cookie: 'cq_session=' + TOKEN } })).json();
ok('Ошибка невалидного токена показывается', (await ev("document.body.innerText.includes('Вебмастер: HTTP') || document.body.innerText.includes('невалид')")) === true);
ok('Невалидный токен не сохраняется', wm.configured === false && wm.tokenSet === false, JSON.stringify(wm));

// мобильная адаптация дашборда
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: BASE + '/app/admin/analytics' });
await sleep(2500);
const mobile = JSON.parse(await ev("(() => JSON.stringify({ vw: innerWidth, sw: document.documentElement.scrollWidth }))()"));
ok('Мобильная админка: без горизонтальной прокрутки', mobile.sw <= mobile.vw + 1, JSON.stringify(mobile));
const mshot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('docs/seo-analytics-mobile.png', Buffer.from(mshot.result.data, 'base64'));

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1300, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/app/admin/analytics' });
await sleep(2600);
await ev(`(() => { window.scrollTo(0,0); return 1; })()`);
await sleep(500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('docs/seo-analytics.png', Buffer.from(shot.result.data, 'base64'));
console.log('screenshot: docs/seo-analytics.png');
console.log('console errors:', errors.length, JSON.stringify(errors.slice(0, 4)));
const failed = checks.filter((x) => !x).length;
console.log(`итог: ${checks.length - failed}/${checks.length}`);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed ? 1 : 0);
