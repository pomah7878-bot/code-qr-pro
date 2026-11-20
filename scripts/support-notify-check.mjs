import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN_A = process.argv[2];
const TOKEN_C = process.argv[3];
const SHOT = process.argv[4] || '';
const PORT = 9691;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-supnotif-'));
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
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
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
const waitFor = async (expression, timeoutMs = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(500);
  }
  return false;
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', file, fs.statSync(file).size);
};

// 1) админ открывает админку, базовый счётчик
await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN_A, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/settings` });
await waitFor(`(document.body.innerText || '').includes('Настройки')`);
await sleep(1200);
console.log('baseline badge:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const m = t.match(/Поддержка\\s*(\\d+)/);
  return JSON.stringify({ badge: m ? Number(m[1]) : 0, toast: document.body.innerText.includes('Новое обращение в поддержку') });
})()`));
const baselineText = await evaluate(`(() => {
  const t = document.body.innerText || '';
  const m = t.match(/Поддержка\\s*(\\d+)/);
  return m ? Number(m[1]) : 0;
})()`);
const baseline = Number(baselineText) || 0;

// 2) клиент отправляет обращение (как будто из AI-помощника)
const ticket = await fetch(`${BASE}/api/assistant/tickets`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: `cq_session=${TOKEN_C}`, Origin: BASE },
  body: JSON.stringify({
    subject: 'QA: сканер не читает этикетку',
    message: 'Проверка уведомления: клиент просит живую поддержку по печати этикеток.',
    aiContext: 'Тестовый разбор.'
  })
});
console.log('ticket created:', ticket.status, await ticket.text());

// 3) ждём опрос счётчика (30 с) и проверяем бейдж + всплывающее уведомление
console.log('waiting for poll (~32s)…');
await waitFor(`(() => {
  const t = document.body.innerText || '';
  const m = t.match(/Поддержка\\s*(\\d+)/);
  return m ? Number(m[1]) > ${baseline} : false;
})()`, 45000);
await sleep(900);
console.log('after ticket:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const badge = (t.match(/Поддержка\\s*(\\d+)/) || [])[1] || null;
  const toast = document.body.innerText.includes('Новое обращение в поддержку');
  return JSON.stringify({ badge: badge ? Number(badge) : 0, toast });
})()`));
if (SHOT) await shot(SHOT);

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
