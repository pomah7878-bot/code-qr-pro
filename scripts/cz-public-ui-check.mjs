import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9791;
const CODE = '0104638230913287215ZsWrd';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-czpub-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1400', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = []; const czRequests = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Network.requestWillBeSent' && /mobile\.api\.crpt\.ru/.test(msg.params.request.url)) {
    czRequests.push({ kind: 'req', method: msg.params.request.method, url: msg.params.request.url, postData: msg.params.request.postData || '', id: msg.params.requestId });
  }
  if (msg.method === 'Network.responseReceived' && /mobile\.api\.crpt\.ru/.test(msg.params.response.url)) {
    czRequests.push({ kind: 'res', status: msg.params.response.status, mime: msg.params.response.mimeType, id: msg.params.requestId });
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

console.log('waiting for public ЧЗ card…');
await waitFor(`(document.body.innerText || '').includes('Карточка товара по коду')`, 45000);
await sleep(4000);

console.log('cz network:', JSON.stringify(czRequests.filter((r) => r.kind === 'res')));
const czReq = czRequests.find((r) => r.kind === 'req');
const czRes = czRequests.find((r) => r.kind === 'res');
console.log('cz request:', JSON.stringify({ method: czReq?.method, postData: czReq?.postData, status: czRes?.status }));
if (czRes?.id) {
  const bodyRes = await send('Network.getResponseBody', { requestId: czRes.id }).catch(() => null);
  const bodyText = bodyRes?.result?.body || '';
  console.log('cz response body head:', JSON.stringify({ bytes: bodyText.length, codeFounded: /"codeFounded"\s*:\s*(true|false)/.exec(bodyText)?.[1], head: bodyText.slice(0, 160) }));
}
console.log('debug hook:', await evaluate(`JSON.stringify(window.__cqCzPublic || null)`));
console.log('card:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const i = t.indexOf('Карточка товара по коду');
  return JSON.stringify({
    found: i >= 0,
    product: t.includes('сыворотка'),
    status: t.includes('В обороте'),
    volume: t.includes('2 мл'),
    brand: t.includes('LIGHT FIT'),
    expiry: t.includes('2028'),
    sourceCz: /ЧЕСТНЫЙ ЗНАК/i.test(t),
    snippet: i >= 0 ? t.slice(i, i + 420).replace(/\\s+/g, ' ') : ''
  });
})()`));

console.log('apply to label:', await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'В этикетку');
  if (btn) btn.click();
  return btn ? 'clicked' : 'not-found';
})()`));
await sleep(600);
console.log('label name:', await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '') === 'Название');
  return input ? input.value : null;
})()`));

await evaluate(`(() => {
  const el = [...document.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('Карточка товара'));
  if (el) el.scrollIntoView({ block: 'center' });
  return 1;
})()`);
await sleep(700);
if (SHOT) await shot(SHOT);

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
