import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * SVG → PNG без внешних зависимостей: рендерим SVG в headless Chrome
 * и снимаем скриншот нужного размера (с прозрачным фоном).
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SVG = process.argv[2];
const OUT = process.argv[3];
const SIZE = Number(process.argv[4] || 132);
const PORT = 9451;

const raw = fs.readFileSync(SVG, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block;width:${SIZE}px;height:${SIZE}px}
</style></head><body>${raw}</body></html>`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-svg-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', 'about:blank'
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
await send('Emulation.setDeviceMetricsOverride', { width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
await sleep(700);
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 0, y: 0, width: SIZE, height: SIZE, scale: 1 },
  captureBeyondViewport: false,
  omitBackground: true
});
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
const stat = fs.statSync(OUT);
console.log(JSON.stringify({ out: OUT, size: SIZE, bytes: stat.size }));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
