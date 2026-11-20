import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN_A = process.argv[2];
const SUBJECT_MARK = process.argv[3] || 'QA:';
const SHOT = process.argv[4] || '';
const PORT = 9701;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ticketai-'));
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

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN_A, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/support` });
await waitFor(`(document.body.innerText || '').includes('Поддержка')`);
await sleep(1500);

console.log('select ticket:', await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(${JSON.stringify(SUBJECT_MARK)}));
  if (!btn) return 'not-found';
  btn.click();
  return 'clicked';
})()`));
await sleep(900);

console.log('ai button:', await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Передать AI-помощнику/.test(b.textContent || ''));
  if (!btn) return 'not-found';
  if (btn.disabled) return 'disabled';
  btn.click();
  return 'clicked';
})()`));

console.log('waiting for AI analysis…');
await waitFor(`document.body.innerText.includes('Решение от AI')`, 90000);
await sleep(1000);
console.log('result:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const idx = t.indexOf('Решение от AI');
  return JSON.stringify({
    hasResult: idx >= 0,
    diagnosis: t.includes('Диагноз'),
    steps: t.includes('Что сделать'),
    reply: t.includes('Ответ клиенту'),
    snippet: idx >= 0 ? t.slice(idx, idx + 260).replace(/\\s+/g, ' ') : ''
  });
})()`));
if (SHOT) await shot(SHOT);

// прокручиваем к полю ответа: видно шаблоны и подставленный ответ
await evaluate(`(() => {
  const el = document.querySelector('#t-note');
  if (el) el.scrollIntoView({ block: 'center' });
  return 1;
})()`);
await sleep(500);
if (SHOT) await shot(SHOT.replace('.png', '-reply.png'));

console.log('templates:', await evaluate(`(() => {
  const labels = ['Решено', 'Нужны детали', 'Инструкция', 'Передано инженеру', 'Компенсация', 'Оплата'];
  const found = labels.filter((l) => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === l));
  return JSON.stringify({ found: found.length, labels: found });
})()`));

console.log('use reply:', await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Подставить в ответ/.test(b.textContent || ''));
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
})()`));
await sleep(500);
console.log('note filled:', await evaluate(`(() => {
  const ta = document.querySelector('#t-note');
  return ta ? ta.value.length : -1;
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
