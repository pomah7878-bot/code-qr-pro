import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9811;
const CODE = '0104638230913287215ZsWrd';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ean-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1400', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = []; const pdfRequests = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Network.requestWillBeSent' && /\/api\/labels\/pdf($|\?)/.test(msg.params.request.url) && msg.params.request.method === 'POST') {
    pdfRequests.push(msg.params.request.postData || '');
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return `EXCEPTION: ${r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};
const waitFor = async (expr, timeoutMs = 40000) => {
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

// вводим 12 цифр — контрольная должна добавиться автоматически
await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '') === 'EAN-13 для маркетплейса');
  if (!input) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '460701234567');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`);
await sleep(1200);
console.log('ean state:', await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '') === 'EAN-13 для маркетплейса');
  const t = document.body.innerText || '';
  return JSON.stringify({
    value: input ? input.value : null,
    okText: /EAN-13 корректен/.test(t),
    noticeText: (t.match(/EAN-13 корректен[^\\n]*/) || [])[0] || null,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((x) => /EAN-13/.test(x))
  });
})()`));

// отдельная этикетка только с EAN-13
pdfRequests.length = 0;
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'PDF только EAN-13');
  if (btn && !btn.disabled) btn.click();
  return 1;
})()`);
await waitFor(`(() => { const t = document.body.innerText || ''; return /PDF (готов|скачан|открылся)/.test(t) || /Не удалось/.test(t); })()`, 40000).catch(() => {});
await sleep(2500);
const body = pdfRequests[0] || '';
let parsed = null;
try { parsed = JSON.parse(body); } catch { /* ignore */ }
console.log('marketplace request:', JSON.stringify({
  requests: pdfRequests.length,
  elements: parsed ? parsed.template.elements.map((el) => el.type) : null,
  hasDatamatrix: parsed ? parsed.template.elements.some((el) => el.type === 'datamatrix') : null,
  barcode: parsed ? parsed.rows?.[0]?.barcode : null,
  rows: parsed ? parsed.rows?.length : null,
  single: parsed ? parsed.single : null,
  notice: await evaluate(`((document.body.innerText || '').match(/PDF (готов|скачан|открылся)[^\\n]*/) || [])[0] || null`)
}));

// КИЗ-этикетка тоже содержит EAN-13
pdfRequests.length = 0;
await evaluate(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(CODE)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await sleep(700);
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /^PDF\\s*\\(\\d+\\)/.test((b.textContent || '').trim()));
  if (btn && !btn.disabled) btn.click();
  return 1;
})()`);
await waitFor(`(() => (${true}))`, 100);
await sleep(6000);
const kizBody = pdfRequests[0] || '';
let kiz = null;
try { kiz = JSON.parse(kizBody); } catch { /* ignore */ }
console.log('kiz request:', JSON.stringify({
  requests: pdfRequests.length,
  hasEan: kiz ? kiz.template.elements.some((el) => el.type === 'ean13') : null,
  hasDatamatrix: kiz ? kiz.template.elements.some((el) => el.type === 'datamatrix') : null,
  barcodeField: kiz ? (kiz.template.elements.find((el) => el.type === 'ean13') || {}).field || null : null,
  rowBarcode: kiz ? kiz.rows?.[0]?.barcode : null
}));

await evaluate(`(() => {
  const el = [...document.querySelectorAll('h3')].find((h) => (h.textContent || '').includes('Данные товара'));
  if (el) el.scrollIntoView({ block: 'center' });
  return 1;
})()`);
await sleep(600);
if (SHOT) await shot(SHOT);

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
