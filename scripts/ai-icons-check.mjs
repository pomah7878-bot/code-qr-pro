import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TOKEN = process.argv[2];
const SHOT_DIR = process.argv[3] || 'docs';
const PORT = 9671;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-aiicon-'));
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
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', file, fs.statSync(file).size);
};
const scrollTo = (text) => evaluate(`(() => {
  const el = [...document.querySelectorAll('h2,h3')].find((h) => (h.textContent || '').includes(${JSON.stringify(text)}));
  if (!el) return 0;
  let node = el;
  while (node) {
    const cs = getComputedStyle(node);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      node.scrollTop += el.getBoundingClientRect().top - 120;
      return 1;
    }
    node = node.parentElement;
  }
  window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 120);
  return 1;
})()`);

await send('Runtime.enable');
await send('Page.enable');

// лендинг: блок «Новое в PREMIUM»
await send('Page.navigate', { url: 'https://code-qr.stockcity.ru/' });
await waitFor(`(document.body.innerText || '').includes('Помощник, который знает')`, 30000);
await sleep(900);
await scrollTo('Помощник, который знает');
await sleep(600);
console.log('landing ai icons:', await evaluate(`(() => {
  const svg = [...document.querySelectorAll('svg')].length;
  return JSON.stringify({ svgs: svg, hasVideo: false });
})()`));
await shot(path.join(SHOT_DIR, 'ai-icon-landing.png'));

// кабинет: баннер «Новое в PREMIUM»
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: 'code-qr.stockcity.ru', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: 'https://code-qr.stockcity.ru/app' });
await waitFor(`(document.body.innerText || '').includes('Новое в PREMIUM')`, 30000);
await sleep(1000);
await shot(path.join(SHOT_DIR, 'ai-icon-dashboard.png'));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
