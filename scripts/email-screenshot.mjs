import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = process.argv[2];
const OUT = process.argv[3];
const WIDTH = Number(process.argv[4] || 390);
const PORT = 9401;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mail-'));
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
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
await new Promise((resolve) => { ws.onopen = resolve; });
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `file:///${FILE.replace(/\\/g, '/')}` });
await sleep(1500);
const metrics = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })',
  returnByValue: true
});
console.log('metrics:', metrics.result?.result?.value);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('saved:', OUT, fs.statSync(OUT).size);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
