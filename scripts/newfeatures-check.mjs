import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN_C = process.argv[2];
const TOKEN_A = process.argv[3];
const SHOT_DIR = process.argv[4] || 'docs';
const PORT = 9581;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-newfeat-'));
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
const waitFor = async (expression, timeoutMs = 25000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(400);
  }
  return false;
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', file, fs.statSync(file).size);
};

await send('Runtime.enable');
await send('Page.enable');

// 1) Лендинг: блок «Новое в PREMIUM»
await send('Page.navigate', { url: BASE });
await waitFor(`(document.body.innerText || '').includes('Новое в PREMIUM')`, 30000);
await sleep(800);
console.log('landing:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    section: t.includes('Новое в PREMIUM'),
    aiCard: t.includes('AI-помощник 24/7'),
    kb: t.includes('База знаний'),
    support: t.includes('Поддержка с историей'),
    mobile: t.includes('Мобильная печать'),
    premiumBadge: t.includes('Новое: AI-помощник и поддержка')
  });
})()`));
await evaluate(`(() => {
  const el = [...document.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('Помощник, который знает'));
  if (el) {
    let node = el;
    while (node) { if (getComputedStyle(node).overflowY === 'auto' && node.scrollHeight > node.clientHeight) { node.scrollTop += el.getBoundingClientRect().top - 80; break; } node = node.parentElement; }
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 80, behavior: 'instant' });
  }
  return 1;
})()`);
await sleep(700);
await shot(path.join(SHOT_DIR, 'landing-premium.png'));

// 2) Кабинет: баннер «Новое в PREMIUM»
await send('Network.setCookie', { name: 'cq_session', value: TOKEN_C, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app` });
await waitFor(`(document.body.innerText || '').includes('Новое в PREMIUM')`, 30000);
await sleep(800);
console.log('dashboard:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({ banner: t.includes('Новое в PREMIUM'), whatNew: t.includes('Что нового'), askAi: t.includes('Спросить AI') });
})()`));
await shot(path.join(SHOT_DIR, 'dashboard-premium.png'));

// 3) Админка: пункт «Помощь» и кнопка AI на странице админки
await send('Network.setCookie', { name: 'cq_session', value: TOKEN_A, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/settings` });
await waitFor(`(document.body.innerText || '').includes('Настройки')`, 30000);
await sleep(1200);
console.log('admin:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    helpTab: [...document.querySelectorAll('a,button')].some((el) => (el.textContent || '').trim() === 'Помощь'),
    aiLauncher: !!document.querySelector('.ai-launcher'),
    aiPage: t.includes('AI-помощник')
  });
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 2)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
