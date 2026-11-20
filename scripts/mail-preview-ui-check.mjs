import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const CLIENT_ID = process.argv[3];
const PORT = 9411;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mpv-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1100', 'about:blank'
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
    if (res.ok) { target = await res.json(); break; }
  } catch { /* not ready */ }
  await sleep(250);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 160));
  }
};
await new Promise((resolve) => { ws.onopen = resolve; });
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return `EXCEPTION: ${r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/users/${CLIENT_ID}` });
await sleep(6000);

console.log('open mail:', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Написать клиенту/.test(x.textContent));
  if (!b) return 'not-found';
  b.click();
  return 'clicked';
})()`));
await sleep(2000);
console.log('click preview:', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Предпросмотр письма/.test(x.textContent));
  if (!b) return 'not-found';
  b.click();
  return 'clicked';
})()`));
await sleep(3000);

console.log('iframe:', await evaluate(`(() => {
  const f = document.querySelector('iframe[title="Предпросмотр письма"]');
  if (!f) return JSON.stringify({ present: false });
  const src = f.getAttribute('srcdoc') || '';
  return JSON.stringify({
    present: true,
    srcdocBytes: src.length,
    brand: src.includes('CODE QR PRO'),
    mark: src.includes('>QR<'),
    cta: src.includes('Войти в кабинет') || src.includes('Открыть кабинет'),
    sandbox: f.getAttribute('sandbox')
  });
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
