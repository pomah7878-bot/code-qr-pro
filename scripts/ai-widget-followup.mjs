import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN_C = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9551;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-followup-'));
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
const setInput = (value) => evaluate(`(() => {
  const area = document.querySelector('.ai-shell textarea');
  if (!area) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, ${JSON.stringify(value)});
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return 'filled';
})()`);
const clickSend = () => evaluate(`(async () => {
  await new Promise((r) => setTimeout(r, 400));
  const btn = [...document.querySelectorAll('.ai-shell button')].find((b) => b.textContent.trim() === 'Спросить');
  if (!btn || btn.disabled) return 'no-send';
  btn.click();
  return 'sent';
})()`);

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN_C, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/labels` });
await waitFor(`!!document.querySelector('.ai-launcher')`);
await evaluate(`(() => { document.querySelector('.ai-launcher')?.click(); return 1; })()`);
await waitFor(`!!document.querySelector('.ai-shell')`);
await sleep(600);

// 1-й вопрос: короткий
console.log('q1:', await setInput('не работает'));
console.log('send1:', await clickSend());
await sleep(22000);
console.log('a1:', await evaluate(`(() => {
  const t = document.querySelector('.ai-shell')?.innerText || '';
  return JSON.stringify({ isQuestion: /\\?/.test(t), clarifyHint: t.includes('Уточнение') });
})()`));

// 2-й вопрос: уточнение — должен получить шаги
console.log('q2:', await setInput('этикетки не печатаются, PDF не скачивается с телефона'));
console.log('send2:', await clickSend());
await sleep(25000);
console.log('a2:', await evaluate(`(() => {
  const bubbles = [...document.querySelectorAll('.ai-shell .rounded-xl')];
  const last = bubbles[bubbles.length - 1]?.innerText || '';
  return JSON.stringify({ steps: /Проверьте|Откройте|Нажмите|скачайте|iPhone|Android/i.test(last), clarifyHint: /Уточнение/.test(last) });
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
