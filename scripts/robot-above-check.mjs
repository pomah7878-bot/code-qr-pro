import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const MODE = process.argv[4] || 'desktop';
const PORT = 9661;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-above-'));
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

await send('Runtime.enable');
await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
}
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/labels` });
await waitFor(`!!document.querySelector('.ai-launcher')`);
await sleep(1500);

console.log('above button:', await evaluate(`(() => {
  const launcher = document.querySelector('.ai-launcher');
  const floats = [...document.querySelectorAll('.ai-robot-float .rb-robot')];
  const lr = launcher.getBoundingClientRect();
  const visible = floats.filter((f) => {
    const r = f.getBoundingClientRect();
    const cs = getComputedStyle(f);
    return r.width > 0 && cs.display !== 'none';
  });
  const v = visible[0];
  const vr = v ? v.getBoundingClientRect() : null;
  return JSON.stringify({
    robotCount: floats.length,
    visibleRobots: visible.length,
    robotAboveButton: vr && lr ? vr.bottom <= lr.top + 6 : null,
    robotW: vr ? Math.round(vr.width) : null,
    robotH: vr ? Math.round(vr.height) : null,
    buttonH: Math.round(lr.height)
  });
})()`));
console.log('launcher rect:', await evaluate(`(() => {
  const r = document.querySelector('.ai-launcher').getBoundingClientRect();
  return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), bottomGap: Math.round(window.innerHeight - r.bottom), rightGap: Math.round(window.innerWidth - r.right) });
})()`));

if (SHOT) await shot(SHOT);

// открываем окно — проверяем, что робот в шапке есть и эмоции работают
await evaluate(`(() => { document.querySelector('.ai-launcher')?.click(); return 1; })()`);
await waitFor(`!!document.querySelector('.ai-shell')`);
await sleep(600);
console.log('open state:', await evaluate(`document.querySelector('.ai-shell .rb-robot')?.dataset.state`));
if (SHOT) await shot(SHOT.replace('.png', '-open.png'));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
