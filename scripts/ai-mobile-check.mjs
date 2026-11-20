import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9571;
const W = Number(process.env.MW) || 390;
const H = Number(process.env.MH) || 844;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mobile-ai-'));
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

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 3, mobile: true
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Network.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
});
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

await send('Page.navigate', { url: `${BASE}/app/labels` });
await waitFor(`!!document.querySelector('.ai-launcher')`);
await sleep(1200);

console.log('launcher (mobile):', await evaluate(`(() => {
  const el = document.querySelector('.ai-launcher');
  if (!el) return 'not-found';
  const r = el.getBoundingClientRect();
  return JSON.stringify({
    w: Math.round(r.width), h: Math.round(r.height),
    bottomGap: Math.round(window.innerHeight - r.bottom),
    rightGap: Math.round(window.innerWidth - r.right),
    labelHidden: !(el.innerText || '').includes('AI-помощник')
  });
})()`));

console.log('open:', await evaluate(`(() => { document.querySelector('.ai-launcher')?.click(); return 1; })()`));
await waitFor(`!!document.querySelector('.ai-shell')`);
await sleep(900);

console.log('sheet:', await evaluate(`(() => {
  const shell = document.querySelector('.ai-shell');
  const panel = document.querySelector('.ai-panel');
  const r = shell.getBoundingClientRect();
  const area = document.querySelector('.ai-shell textarea');
  const sendBtn = [...document.querySelectorAll('.ai-shell button')].find((b) => b.textContent.trim() === 'Спросить');
  const ta = area?.getBoundingClientRect();
  const sb = sendBtn?.getBoundingClientRect();
  return JSON.stringify({
    left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    fullWidth: Math.round(r.width) >= window.innerWidth - 2,
    inputVisible: ta ? ta.bottom <= window.innerHeight + 1 && ta.top >= 0 : false,
    inputFontPx: area ? parseFloat(getComputedStyle(area).fontSize) : null,
    sendBtn: sendBtn ? { w: Math.round(sb.width), h: Math.round(sb.height) } : null,
    noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    bodyLocked: document.body.style.overflow === 'hidden',
    handle: !!document.querySelector('.ai-sheet-handle')
  });
})()`));

if (SHOT) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', SHOT, fs.statSync(SHOT).size);
}

console.log('console errors:', consoleErrors.length);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
