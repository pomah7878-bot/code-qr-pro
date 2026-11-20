import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const CLIENT_ID = process.argv[3];
const PORT = 9382;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-view-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1000', 'about:blank'
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

// Админ создаёт ссылку просмотра через fetch внутри страницы (cookie админа уже стоит).
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app` });
await sleep(4000);
const viewUrl = await evaluate(`fetch('/api/admin/users/${CLIENT_ID}/impersonate', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  .then((r) => r.json()).then((d) => d.url || '').catch(() => '')`);
console.log('view url:', String(viewUrl).slice(0, 70) + '…');
const viewToken = String(viewUrl).split('/').pop();

// Открываем ссылку — сервер ставит cq_view.
await send('Page.navigate', { url: String(viewUrl) });
await sleep(4000);
await send('Page.navigate', { url: `${BASE}/app` });
await sleep(4500);

console.log('banner:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    viewMode: t.includes('Режим просмотра от имени клиента'),
    readOnly: t.includes('только чтение'),
    exitBtn: t.includes('Выйти из просмотра'),
    meClient: t.includes('QA клиент') || t.includes('qa-ui7-client')
  });
})()`));

// Чтение работает, запись блокируется.
console.log('read ok:', await evaluate(`fetch('/api/me', { credentials: 'include' }).then(r => r.json()).then(d => JSON.stringify({ email: d.user && d.user.email, impersonated: d.impersonated })).catch(e => 'ERR ' + e.message)`));
console.log('write blocked:', await evaluate(`fetch('/api/auth/2fa/setup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status).catch(e => 'ERR ' + e.message)`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
