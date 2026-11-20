import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const PORT = 9372;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-logs-'));
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
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

const marker = 'QA-browser-' + Date.now();

// 1) Клиентская ошибка из браузера (админ уже авторизован, чтобы сразу проверить API).
await send('Page.navigate', { url: `${BASE}/` });
await sleep(3500);
await evaluate(`setTimeout(() => { throw new Error(${JSON.stringify(marker)}); }, 50); 1`);
await sleep(2500);

console.log('api log row:', await evaluate(`fetch('/api/admin/logs?days=1&per=50&q=' + encodeURIComponent(${JSON.stringify(marker)}), { credentials: 'include' })
  .then((r) => r.json())
  .then((d) => JSON.stringify({ total: d.total, first: d.logs?.[0] ? { source: d.logs[0].source, event: d.logs[0].event, message: d.logs[0].message.slice(0, 60) } : null }))
  .catch((e) => 'ERR ' + e.message)`));

// 2) Страница журнала.
await send('Page.navigate', { url: `${BASE}/app/admin/logs` });
await sleep(6000);

console.log('path:', await evaluate('location.pathname'));
console.log('page:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const counters = [...document.querySelectorAll('.chip-soon')].map((el) => el.textContent.trim()).filter(Boolean).slice(0, 5);
  return JSON.stringify({ title: t.includes('Журнал ошибок'), filters: t.includes('Уровень') && t.includes('Источник'), counters });
})()`));

console.log('open first row:', await evaluate(`(() => {
  const row = document.querySelector('tbody tr');
  if (!row) return 'no-rows';
  row.click();
  return 'clicked';
})()`));
await sleep(1500);
console.log('modal:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({ open: t.includes('Запись журнала'), copy: t.includes('Скопировать диагностику') });
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
