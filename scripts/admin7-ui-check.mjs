import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const CLIENT_ID = process.argv[3];
const PORT = 9381;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-a7-'));
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
const click = (pattern) => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => ${pattern}.test(x.textContent.trim()));
  if (!b) return 'not-found';
  if (b.disabled) return 'disabled';
  b.click();
  return 'clicked';
})()`);

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

await send('Page.navigate', { url: `${BASE}/app/admin/users/${CLIENT_ID}` });
await sleep(6000);

console.log('page:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    quickHelp: t.includes('Быстрая помощь'),
    logins: t.includes('Последние входы'),
    mailBtn: t.includes('Написать клиенту'),
    viewBtn: t.includes('Смотреть как клиент'),
    compBtn: t.includes('Компенсация'),
    keysBtn: t.includes('Отозвать API-ключи')
  });
})()`));

console.log('open mail:', await click('/Написать клиенту/'));
await sleep(1800);
console.log('mail modal:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const sel = document.querySelector('select');
  return JSON.stringify({ title: t.includes('Письмо клиенту'), options: sel ? sel.options.length : 0, hasSend: t.includes('Отправить') });
})()`));
await click('/Отмена/');
await sleep(800);

console.log('open comp:', await click('/Компенсация/'));
await sleep(1200);
console.log('comp modal:', await evaluate(`document.body.innerText.includes('Компенсация за инцидент')`));
await click('/Отмена/');
await sleep(800);

const before = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).length;
console.log('view as client:', await click('/Смотреть как клиент/'));
await sleep(4000);
const afterTargets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
console.log('targets before/after:', before, afterTargets.length);
for (const t of afterTargets.filter((x) => /^https?:/.test(String(x.url)))) console.log('  target:', String(t.url).slice(0, 90));

await send('Page.navigate', { url: `${BASE}/app/admin/settings` });
await sleep(5000);
console.log('settings allowlist:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({ card: t.includes('Защитные лимиты'), allow: t.includes('Белый список IP'), add: t.includes('Добавить') });
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
