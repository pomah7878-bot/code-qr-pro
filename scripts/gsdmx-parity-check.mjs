import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9841;
const CODE = '0104638230913287215ZsWrd';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-gsdmx-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1400', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = []; const printRequests = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Network.requestWillBeSent' && /\/api\/labels\/print$/.test(msg.params.request.url) && msg.params.request.method === 'POST') {
    printRequests.push(msg.params.request.postData || '');
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
await waitFor(`!!document.querySelector('textarea')`);
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
await sleep(4000);

console.log('auto-filled:', await evaluate(`(() => {
  const val = (ph) => {
    const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '') === ph);
    return input ? input.value : '';
  };
  return JSON.stringify({
    name: val('Название'),
    form: val('Форма выпуска'),
    size: val('Размер'),
    expiry: val('Срок годности'),
    manufacturer: val('Производитель'),
    composition: (val('Состав') || '').slice(0, 40)
  });
})()`));

console.log('results table:', await evaluate(`(() => {
  const headers = [...document.querySelectorAll('table thead th')].map((th) => (th.textContent || '').trim());
  const row = [...document.querySelectorAll('table tbody tr')][0];
  const cells = row ? [...row.querySelectorAll('td')].map((td) => (td.textContent || '').trim()) : [];
  return JSON.stringify({ headers, cells: cells.slice(0, 12) });
})()`));

// EAN-13 и пресет «как gsdmx»
await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '') === 'EAN-13 для маркетплейса');
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '4607012345677');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const preset = [...document.querySelectorAll('button')].find((b) => /Как в сервисах проверки/.test(b.textContent || ''));
  if (preset) preset.click();
  return 1;
})()`);
await sleep(900);

printRequests.length = 0;
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Печать');
  if (btn && !btn.disabled) btn.click();
  return 1;
})()`);
await sleep(4000);
const body = printRequests[0] || '';
let parsed = null;
try { parsed = JSON.parse(body); } catch { /* ignore */ }
console.log('print template:', JSON.stringify({
  requests: printRequests.length,
  size: parsed ? [parsed.template.widthMm, parsed.template.heightMm] : null,
  elements: parsed ? parsed.template.elements.map((el) => ({ type: el.type, field: el.field || null, x: el.x, y: el.y, w: el.w, h: el.h })) : null
}));

// визуальная проверка: рендерим HTML печати в iframe
if (body) {
  await evaluate(`(async () => {
    const res = await fetch('/api/labels/print', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: ${JSON.stringify(body)}
    });
    const html = await res.text();
    document.querySelector('#cq-preview-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'cq-preview-frame';
    frame.style.cssText = 'position:fixed;left:20px;top:120px;width:320px;height:240px;background:#fff;z-index:99999;border:1px solid #888;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open(); doc.write(html); doc.close();
    return res.status;
  })()`);
  await sleep(2000);
  if (SHOT) await shot(SHOT);
}

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
