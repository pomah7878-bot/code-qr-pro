import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'https://code-qr.stockcity.ru/ai-button-demo.html';
const SHOT = process.argv[2] || 'docs/ai-button-variants.png';
const PORT = 9601;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-bots-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1280,820', 'about:blank'
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(2500);

console.log('variants:', await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.card')];
  return JSON.stringify({
    count: cards.length,
    titles: cards.map((c) => (c.querySelector('.caption b')?.textContent || '').trim()),
    bots: document.querySelectorAll('.bot').length
  });
})()`));

// наводим курсор на вторую (классик), чтобы глаза и руки смотрели на курсор
await evaluate(`(() => {
  const el = document.querySelectorAll('.bot')[1];
  const r = el.getBoundingClientRect();
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width - 12, clientY: r.top + 18, bubbles: true }));
  return 1;
})()`);
await sleep(900);

const r1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(SHOT, Buffer.from(r1.result.data, 'base64'));
console.log('screenshot:', SHOT, fs.statSync(SHOT).size);
console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 2)));

// второй скриншот: курсор справа снизу — глаза поворачиваются
await evaluate(`(() => {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1200, clientY: 760, bubbles: true }));
  return 1;
})()`);
await sleep(700);
const r2 = await send('Page.captureScreenshot', { format: 'png' });
const SHOT2 = SHOT.replace('.png', '-look.png');
fs.writeFileSync(SHOT2, Buffer.from(r2.result.data, 'base64'));
console.log('screenshot:', SHOT2, fs.statSync(SHOT2).size);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
