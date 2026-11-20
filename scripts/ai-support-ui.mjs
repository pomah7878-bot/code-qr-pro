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
const PORT = 9531;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-help-'));
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

// 1) Клиент: страница AI-помощника
await send('Network.setCookie', { name: 'cq_session', value: TOKEN_C, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/assistant` });
await waitFor(`(document.body.innerText || '').includes('AI-помощник')`);
await sleep(1200);

console.log('ask:', await evaluate(`(async () => {
  const chip = [...document.querySelectorAll('button')].find((b) => /Код не читается сканером/.test(b.textContent || ''));
  const area = document.querySelector('textarea');
  if (!chip || !area) return 'no-inputs';
  chip.click();
  await new Promise((r) => setTimeout(r, 400));
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, 'Код не читается сканером, что проверить?');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const sendBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Спросить');
  if (!sendBtn || sendBtn.disabled) return 'no-send';
  sendBtn.click();
  return 'sent';
})()`));
await sleep(28000);

console.log('client answer:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    hasAnswer: t.includes('0,4') || t.includes('0.4') || t.includes('GTIN') || t.includes('контраст'),
    sources: t.includes('Источники'),
    supportBtn: t.includes('Передать в поддержку') || t.includes('передать вопрос администратору'),
    tickets: t.includes('Мои обращения в поддержку'),
    mojibake: /Р[џѕ°]|вЂ/.test(t)
  });
})()`));
await shot(path.join(SHOT_DIR, 'client-assistant.png'));

// 2) Админ: страница «Поддержка»
await send('Network.setCookie', { name: 'cq_session', value: TOKEN_A, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/support` });
await waitFor(`(document.body.innerText || '').includes('Поддержка')`);
await sleep(1500);

console.log('admin page:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    ticketsTab: t.includes('Обращения'),
    kbTab: t.includes('База знаний'),
    hasTicket: t.includes('Сканер не читает DataMatrix'),
    counts: /открыто: \\d+/.test(t)
  });
})()`));
await shot(path.join(SHOT_DIR, 'admin-support.png'));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
