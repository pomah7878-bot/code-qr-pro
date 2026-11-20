import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const CLIENT_EMAIL = process.argv[3];
const SHOT = process.argv[4] || '';
const PORT = 9491;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-aipage-'));
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

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/ai` });

const waitFor = async (expression, timeoutMs = 25000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(400);
  }
  return false;
};

await waitFor(`!!document.querySelector('#ai-user-search')`);
await sleep(500);

console.log('page:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({ title: t.includes('AI-помощник'), search: Boolean(document.querySelector('#ai-user-search')), ready: t.includes('готов к работе') });
})()`));

console.log('search:', await evaluate(`(async () => {
  const input = document.querySelector('#ai-user-search');
  if (!input) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(CLIENT_EMAIL)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1500));
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(${JSON.stringify(CLIENT_EMAIL)}));
  if (!btn) return 'no-result';
  btn.click();
  return 'selected';
})()`));
await sleep(2500);

console.log('ask:', await evaluate(`(async () => {
  const chip = [...document.querySelectorAll('button')].find((b) => /не может войти/.test(b.textContent || ''));
  if (chip) chip.click();
  await new Promise((r) => setTimeout(r, 600));
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Спросить');
  if (!btn) return 'no-send';
  if (btn.disabled) return 'disabled';
  btn.click();
  return 'sent';
})()`));
await sleep(35000);

console.log('answer:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    diagnosis: t.includes('Диагноз'),
    steps: t.includes('Что сделать'),
    draft: t.includes('Черновик письма'),
    model: t.includes('dsh-headless'),
    error: /Ошибка|не настроен/.test(t) ? t.slice(0, 160) : null
  });
})()`));

if (SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot:', SHOT, fs.statSync(SHOT).size);
}

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
