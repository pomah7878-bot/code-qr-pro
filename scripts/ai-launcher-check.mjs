import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT_DIR = process.argv[3] || 'docs';
const PORT = 9591;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cute-'));
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
    await sleep(400);
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
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await evaluate(`(() => { try { sessionStorage.removeItem('cq_ai_hint_shown'); } catch {} return 1; })()`);
await send('Page.navigate', { url: `${BASE}/app` });
await waitFor(`!!document.querySelector('.ai-launcher')`);
await sleep(800);

console.log('launcher decor:', await evaluate(`(() => {
  const b = document.querySelector('.ai-launcher');
  const cs = b ? getComputedStyle(b) : null;
  return JSON.stringify({
    exists: !!b,
    animation: cs ? cs.animationName : null,
    shimmer: !!document.querySelector('.ai-shimmer'),
    shimmerAnim: (() => { const s = document.querySelector('.ai-shimmer'); return s ? getComputedStyle(s, '::after').animationName : null; })(),
    dot: !!document.querySelector('.ai-notify-dot'),
    bubble: !!document.querySelector('.ai-hint-bubble')
  });
})()`));

console.log('waiting for the friendly reminder (~23s)…');
await waitFor(`!!document.querySelector('.ai-hint-bubble')`, 30000);
await sleep(700);
console.log('bubble:', await evaluate(`(() => {
  const b = document.querySelector('.ai-hint-bubble');
  if (!b) return JSON.stringify({ shown: false });
  const r = b.getBoundingClientRect();
  return JSON.stringify({
    shown: true,
    text: b.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80),
    dotOn: !!document.querySelector('.ai-notify-dot.is-on'),
    fitsScreen: r.width <= window.innerWidth && r.top >= 0
  });
})()`));
await shot(path.join(SHOT_DIR, 'ai-launcher-cute.png'));

console.log('click bubble:', await evaluate(`(() => { document.querySelector('.ai-hint-bubble')?.click(); return 1; })()`));
await waitFor(`!!document.querySelector('.ai-shell')`);
console.log('opens dialog:', await evaluate(`!!document.querySelector('.ai-shell')`));
await sleep(600);
console.log('bubble dismissed:', await evaluate(`!document.querySelector('.ai-hint-bubble')`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 2)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
