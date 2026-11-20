import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const MODE = process.argv[4] || 'mobile';
const PORT = 9681;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mobbtn-'));
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
await sleep(1400);

console.log('layout:', await evaluate(`(() => {
  const launcher = document.querySelector('.ai-launcher');
  const floatWrap = document.querySelector('.ai-robot-float');
  const robots = [...document.querySelectorAll('.ai-robot-float .rb-robot')];
  const visible = robots.filter((r) => r.getBoundingClientRect().width > 0);
  const lr = launcher.getBoundingClientRect();
  return JSON.stringify({
    launcher: { w: Math.round(lr.width), h: Math.round(lr.height), bottomGap: Math.round(window.innerHeight - lr.bottom), rightGap: Math.round(window.innerWidth - lr.right) },
    robotWrapperVisible: floatWrap ? floatWrap.getBoundingClientRect().height > 0 : null,
    visibleRobots: visible.length
  });
})()`));

if (SHOT) await shot(SHOT);

// открываем окно: на телефоне робот не должен появляться, кнопка скрыта, окно на весь экран
await evaluate(`(() => { document.querySelector('.ai-launcher')?.click(); return 1; })()`);
await waitFor(`!!document.querySelector('.ai-shell')`);
await sleep(600);
console.log('open:', await evaluate(`(() => {
  const dock = document.querySelector('.ai-dock');
  const robots = [...document.querySelectorAll('.rb-robot')].filter((r) => r.getBoundingClientRect().width > 0);
  return JSON.stringify({
    dockVisible: dock ? getComputedStyle(dock).display !== 'none' : null,
    visibleRobots: robots.length,
    headerRobot: !!document.querySelector('.ai-shell .rb-robot')
  });
})()`));
if (SHOT) await shot(SHOT.replace('.png', '-open.png'));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
