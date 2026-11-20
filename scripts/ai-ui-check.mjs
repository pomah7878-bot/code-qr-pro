import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const CLIENT_ID = process.argv[3];
const PORT = 9461;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ai-'));
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
const clickText = (pattern, scope = 'button') => evaluate(`(() => {
  const el = [...document.querySelectorAll('${scope}')].find((x) => ${pattern}.test(x.textContent || ''));
  if (!el) return 'not-found';
  if (el.disabled) return 'disabled';
  el.click();
  return 'clicked';
})()`);

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/users/${CLIENT_ID}` });
await sleep(6000);

console.log('ai button:', await clickText('/Спросить ИИ/'));
await sleep(1500);
console.log('modal:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    title: t.includes('AI-помощник'),
    chips: [...document.querySelectorAll('button')].filter((b) => /не может войти|PDF|лимит|Оплата/.test(b.textContent || '')).length,
    textarea: Boolean(document.querySelector('textarea'))
  });
})()`));

console.log('chip:', await clickText('/Клиент не может войти/'));
await sleep(500);
console.log('ask:', await clickText('/Получить разбор/'));
await sleep(6000);

console.log('answer:', await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"]') || document.body;
  const t = dialog.innerText || '';
  return JSON.stringify({
    hasDiagnosis: t.includes('Диагноз'),
    hasSteps: t.includes('Что сделать'),
    hasDraft: t.includes('Черновик письма'),
    confidence: t.includes('уверен'),
    actions: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((x) => ['Разблокировать вход', 'Сбросить 2FA', 'Написать клиенту'].includes(x))
  });
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
