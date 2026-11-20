import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9871;
const CODE = '(01)04638230913287(21)5ZsWrd(91)EE12(92)f2+hPGe2ZRc2FmzC1oFm+6Nwt1PxgpCRp9khyOKEEG4w=';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-full-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1400', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = []; const cz = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Network.responseReceived' && /mobile\.api\.crpt\.ru/.test(msg.params.response.url)) {
    cz.push({ status: msg.params.response.status, id: msg.params.requestId });
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return `EXCEPTION: ${r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};
const waitFor = async (expr, timeoutMs = 45000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (await evaluate(expr)) return true; await sleep(400); }
  return false;
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', file, fs.statSync(file).size);
};

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/reprint` });
await waitFor(`!!document.querySelector('textarea')`, 25000);
await sleep(1500);

await evaluate(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(CODE)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await sleep(600);
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Проверить коды');
  if (btn && !btn.disabled) btn.click();
  return 1;
})()`);
await waitFor(`(document.body.innerText || '').includes('Карточка товара по коду')`, 45000);
await sleep(5000);
// переключаем «Все поля»
await evaluate("(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Все поля'); if (b) b.click(); return 1; })()");
await sleep(1000);

console.log('cz requests:', JSON.stringify(cz));
console.log('row:', await evaluate(`(() => {
  const headers = [...document.querySelectorAll('table thead th')].map((th) => (th.textContent || '').trim());
  const row = document.querySelector('table tbody tr');
  const cells = row ? [...row.querySelectorAll('td')].map((td) => (td.textContent || '').trim()) : [];
  const t = document.body.innerText || '';
  return JSON.stringify({
    headers,
    cells,
    status: (t.match(/Код не найден в ЧЗ[^\\n]*/) || [])[0] || null
  });
})()`));

console.log('auto-filled:', await evaluate(`(() => {
  const val = (ph) => {
    const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '') === ph);
    return input ? input.value : '';
  };
  return JSON.stringify({ name: val('Название'), size: val('Размер'), expiry: val('Срок годности'), date: val('Дата') });
})()`));

await evaluate(`(() => {
  const el = [...document.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('Результаты проверки'));
  if (el) el.scrollIntoView({ block: 'center' });
  return 1;
})()`);
await sleep(700);
if (SHOT) await shot(SHOT);
console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
