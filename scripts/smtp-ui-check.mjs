import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const PORT = 9441;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-smtp-'));
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
await send('Page.navigate', { url: `${BASE}/app/admin/settings` });
await sleep(6000);

console.log('smtp ui:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const sel = document.querySelector('#smtp-logo-mode');
  return JSON.stringify({
    logoField: Boolean(sel),
    options: sel ? [...sel.options].map((o) => o.value) : [],
    urlField: Boolean(document.querySelector('#smtp-logo-url')),
    hint: t.includes('фирменном шаблоне')
  });
})()`));

console.log('templates:', await evaluate(`fetch('/api/admin/mail-templates', { credentials: 'include' })
  .then((r) => r.json())
  .then((d) => JSON.stringify({ count: d.templates.length, ids: d.templates.map((t) => t.id) }))
  .catch((e) => 'ERR ' + e.message)`));

console.log('smtp settings api:', await evaluate(`fetch('/api/admin/settings/smtp', { credentials: 'include' })
  .then((r) => r.json())
  .then((d) => JSON.stringify({ logoMode: d.logoMode, logoUrl: d.logoUrl || '', configured: d.configured }))
  .catch((e) => 'ERR ' + e.message)`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
