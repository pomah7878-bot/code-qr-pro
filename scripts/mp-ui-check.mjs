// UI-смоук раздела «Маркетплейсы»: node scripts/mp-ui-check.mjs [base]
// Требует запущенный сервер (по умолчанию тестовый :3101) и установленный Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:3101';
const HOST = new URL(BASE).hostname;
const PORT = 9813;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg, dump) { if (!cond) { console.error('FAIL:', msg, dump ? JSON.stringify(dump).slice(0, 400) : ''); process.exit(1); } console.log('ok:', msg); }

// сессия тестового пользователя
const reg = await fetch(BASE + '/api/auth/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: 'mp-ui-' + Date.now() + '@test.local', password: 'testpass123', name: 'MP UI', consent: true })
});
const cookie = (reg.headers.get('set-cookie') || '').split(';')[0].split('=').slice(1).join('=');
assert(reg.status === 200 && cookie, 'тестовая сессия получена');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mp-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1400', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
assert(target, 'Chrome запущен');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return 'EXCEPTION: ' + r.result.exceptionDetails.text;
  return r.result?.result?.value;
};
const waitFor = async (expr, timeoutMs = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (await evaluate(expr)) return true; await sleep(400); }
  return false;
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', file, fs.statSync(file).size);
};
const setInput = (selector, value) => evaluate('(() => {'
  + 'const el = document.querySelector(' + JSON.stringify(selector) + ');'
  + 'if (!el) return "no-input";'
  + 'const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;'
  + 'setter.call(el, ' + JSON.stringify(value) + ');'
  + 'el.dispatchEvent(new Event("input", { bubbles: true }));'
  + 'return "typed";})()');
const clickText = (text) => evaluate('(() => {'
  + 'const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === ' + JSON.stringify(text) + ');'
  + 'if (!btn) return "no-button"; if (btn.disabled) return "disabled"; btn.click(); return "clicked";})()');

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Network.setCookie', { name: 'cq_session', value: cookie, domain: HOST, path: '/', secure: BASE.startsWith('https'), httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: BASE + '/app/marketplaces' });
assert(await waitFor('(document.body.innerText || "").includes("Маркетплейсы") && !!document.querySelector("#mp-profile")'), 'страница загрузилась');
await sleep(1200);

const desktop = await evaluate('(() => {'
  + 'const t = document.body.innerText || "";'
  + 'const opts = [...document.querySelectorAll("#mp-profile option")].map((o) => o.value);'
  + 'return JSON.stringify({'
  + 'markets: ["Wildberries", "Ozon", "Яндекс Маркет"].filter((m) => t.includes(m)).length,'
  + 'tabs: ["Товарная этикетка", "Этикетка отправки", "Мои товары", "Документы"].filter((m) => t.includes(m)).length,'
  + 'profiles: opts,'
  + 'sourceLink: !!document.querySelector("a[href*=seller], a[href*=ozon], a[href*=yandex]"),'
  + 'overflow: document.documentElement.scrollWidth > window.innerWidth'
  + '});})()');
const d = JSON.parse(desktop);
assert(d.markets === 3, 'три площадки на экране');
assert(d.tabs === 4, 'четыре вкладки');
assert(d.profiles.includes('wb-product-58x40'), 'профиль WB в списке');
assert(await clickText('Ozon') === 'clicked', 'площадка Ozon выбрана');
await sleep(600);
const ozOpts = await evaluate('[...document.querySelectorAll("#mp-profile option")].map((o) => o.value).join(",")');
assert(String(ozOpts).includes('ozon-product-58x40'), 'профили Ozon после переключения');
assert(await clickText('Wildberries') === 'clicked', 'возврат на Wildberries');
await sleep(400);
assert(d.sourceLink, 'ссылка на официальный источник');
assert(!d.overflow, 'десктоп: нет горизонтального переполнения');
await shot('docs/marketplaces-desktop.png');

// предпросмотр с валидным EAN-13
assert(await setInput('#mp-name', 'Сыворотка LF') === 'typed', 'наименование введено');
assert(await setInput('#mp-barcode', '4638230913287') === 'typed', 'штрихкод введён');
assert(await clickText('Предпросмотр') === 'clicked', 'предпросмотр запрошен');
assert(await waitFor('!!document.querySelector("img[src^=\\"data:image/png\\"]") && (document.body.innerText || "").includes("Количество")'), 'макет с PNG штрихкода построен');
const previewState = await evaluate('(() => {'
  + 'const t = document.body.innerText || "";'
  + 'const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Скачать PDF");'
  + 'return JSON.stringify({ problems: (t.match(/✕[^\\n]*/g) || []), pdfEnabled: btn ? !btn.disabled : null, size: (t.match(/\\d+×\\d+ мм/) || [])[0] });})()');
const ps = JSON.parse(previewState);
assert(ps.pdfEnabled === true, 'кнопка PDF активна после валидного предпросмотра', ps);
assert(ps.size === '58×40 мм', 'размер макета 58×40 мм', ps);
await shot('docs/marketplaces-preview.png');

// вкладка отправки
assert(await clickText('Этикетка отправки') === 'clicked', 'вкладка отправки открыта');
assert(await waitFor('(document.body.innerText || "").includes("Оригинал из кабинета")'), 'блок загрузки оригинала виден');
assert(await evaluate('!!document.querySelector("input[type=file]")'), 'поле загрузки файла есть');

// мобильный вид 390×844
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: BASE + '/app/marketplaces' });
assert(await waitFor('!!document.querySelector("#mp-profile")'), 'мобильная страница загрузилась');
await sleep(1200);
const mobile = await evaluate('(() => {'
  + 'const inSection = [...document.querySelectorAll("section button")].filter((b) => b.offsetHeight > 0 && b.offsetHeight < 40 && !b.closest(".border-l-4"));'
  + 'const globalSmall = [...document.querySelectorAll("button")].filter((b) => b.offsetHeight > 0 && b.offsetHeight < 40).map((b) => (b.textContent || b.getAttribute("aria-label") || "icon").trim().slice(0, 20));'
  + 'return JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth, smallButtons: inSection.length, width: document.documentElement.scrollWidth, globalSmall });})()');
const m = JSON.parse(mobile);
assert(!m.overflow, 'мобильный: нет горизонтального переполнения', m);
assert(m.smallButtons === 0, 'мобильный: тап-таргеты раздела не меньше 40px', m);
console.log('info: мелкие кнопки вне раздела (общие элементы сайта):', JSON.stringify(m.globalSmall));
await shot('docs/marketplaces-mobile.png');

const realErrors = consoleErrors.filter((e) => !/favicon|404|net::ERR/.test(e));
assert(realErrors.length === 0, 'нет ошибок консоли', realErrors);

try { ws.close(); } catch { /* ignore */ }
try { chrome.kill(); } catch { /* ignore */ }
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
console.log('\nALL MARKETPLACES UI CHECKS PASSED');
process.exit(0);
