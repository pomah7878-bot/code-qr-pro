import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9561;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-help2-'));
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
const waitFor = async (expression, timeoutMs = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(400);
  }
  return false;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

// 1) кабинет: всплывающей «Помощи» больше нет, кнопка AI осталась
await send('Page.navigate', { url: `${BASE}/app` });
await waitFor(`!!document.querySelector('.ai-launcher')`);
await sleep(1200);
console.log('dashboard:', await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  return JSON.stringify({
    floatingHelpPopup: buttons.some((t) => t === 'Помощь'),
    aiButton: buttons.some((t) => t.includes('AI-помощник')),
    navHelp: [...document.querySelectorAll('a')].some((a) => (a.textContent || '').trim() === 'Помощь')
  });
})()`));

// 2) страница «Помощь»
await send('Page.navigate', { url: `${BASE}/app/help` });
await waitFor(`(document.body.innerText || '').includes('Короткие подсказки')`);
await sleep(1000);
console.log('help page:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    title: t.includes('Помощь'),
    aiCard: t.includes('AI-помощник'),
    hints: t.includes('Подсказки на страницах'),
    blocks: t.includes('Генерация') && t.includes('Повторная печать') && t.includes('Этикетки'),
    mobile: t.includes('Печать с телефона'),
    mojibake: /Р[џѕ°]|вЂ/.test(t)
  });
})()`));
if (SHOT) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(SHOT, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', SHOT, fs.statSync(SHOT).size);
}
console.log('console errors:', consoleErrors.length);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
