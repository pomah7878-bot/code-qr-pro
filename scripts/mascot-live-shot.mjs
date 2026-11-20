import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'https://code-qr.stockcity.ru/mascot-live.html';
const SHOT = process.argv[3] || 'docs/mascot-live.png';
const PORT = 9631;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-live-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'
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
await send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 1120, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(2200);

console.log('robots:', await evaluate(`JSON.stringify({
  total: document.querySelectorAll('.robot').length,
  states: [...document.querySelectorAll('.robot')].map((r) => r.dataset.state),
  eyes: document.querySelectorAll('.r-eye').length
})`));

// наводим на робота, чтобы глаза смотрели на курсор
await evaluate(`(() => {
  const r = document.querySelector('#main-mount .robot').getBoundingClientRect();
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width - 10, clientY: r.top + 60, bubbles: true }));
  return 1;
})()`);
await sleep(800);
const r1 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(SHOT, Buffer.from(r1.result.data, 'base64'));
console.log('screenshot:', SHOT, fs.statSync(SHOT).size);

// состояние «думает» крупным планом
await evaluate(`(() => { document.querySelector('#state-chips button[data-state="think"]').click(); return 1; })()`);
await sleep(700);
const clip = await evaluate(`(() => {
  const r = document.querySelector('.stage').getBoundingClientRect();
  return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
})()`);
const box = JSON.parse(clip);
const r2 = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }
});
const SHOT2 = SHOT.replace('.png', '-think.png');
fs.writeFileSync(SHOT2, Buffer.from(r2.result.data, 'base64'));
console.log('screenshot:', SHOT2, fs.statSync(SHOT2).size);

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
