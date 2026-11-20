import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9761;
const CODE = '0104638230913287215ZsWrd';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-reprintcap-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });

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
const waitFor = async (expr, timeoutMs = 25000) => {
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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/reprint` });
await waitFor(`!!document.querySelector('textarea')`);
await sleep(1200);

console.log('checkbox:', await evaluate(`(() => {
  const label = [...document.querySelectorAll('label')].find((l) => /Подписывать код/.test(l.textContent || ''));
  const input = label ? label.querySelector('input[type="checkbox"]') : null;
  return JSON.stringify({ found: Boolean(label), checked: input ? input.checked : null });
})()`));

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
await waitFor(`(document.body.innerText || '').includes('PDF')`, 40000).catch(() => {});
await sleep(4000);

const body = pdfRequests[0] || '';
let template = null;
try { template = JSON.parse(body).template; } catch { /* ignore */ }
console.log('pdf request:', JSON.stringify({
  requests: pdfRequests.length,
  elements: template ? template.elements.map((el) => ({ type: el.type, field: el.field || null, id: el.id })) : null
}));

await evaluate(`(() => {
  const ta = document.querySelector('textarea');
  if (ta) ta.scrollIntoView({ block: 'center' });
  return 1;
})()`);
await sleep(500);
if (SHOT) await shot(SHOT);

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
