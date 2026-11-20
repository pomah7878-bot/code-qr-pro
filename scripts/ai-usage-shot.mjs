import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9521;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-usage-'));
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

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/settings` });
await waitFor(`(document.body.innerText || '').includes('Использование и остатки')`, 30000);
await sleep(2500); // даём загрузиться /api/admin/ai/usage

console.log('usage card:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const card = [...document.querySelectorAll('div')].find((d) => (d.textContent || '').includes('Использование и остатки') && (d.textContent || '').includes('Kilo'));
  return JSON.stringify({
    section: t.includes('Использование и остатки'),
    kilo: t.includes('Бесплатные модели Kilo'),
    freeModels: (t.match(/(\\d+)\\s*доступно/) || [])[1] || null,
    balance: (t.match(/Баланс:\\s*([^\\n]+)/) || [])[1] || null,
    estimate: (t.match(/Хватит примерно на\\s*([\\d\\s]+)/) || [])[1] || null
  });
})()`));

await evaluate(`(() => {
  const el = [...document.querySelectorAll('div')].find((d) => (d.textContent || '').includes('Использование и остатки'));
  if (el) el.scrollIntoView({ block: 'center' });
  return 1;
})()`);
await sleep(800);

if (SHOT) {
  const box = await evaluate(`(() => {
    const list = [...document.querySelectorAll('div')].filter((d) => {
      const t = d.textContent || '';
      return t.includes('Использование и остатки') && t.includes('Бесплатные модели Kilo') && t.includes('Платный аккаунт');
    });
    list.sort((a, b) => a.offsetWidth * a.offsetHeight - b.offsetWidth * b.offsetHeight);
    const el = list[0];
    if (!el) return null;
    let top = 0, left = 0, node = el;
    while (node) { top += node.offsetTop; left += node.offsetLeft; node = node.offsetParent; }
    return { x: Math.max(0, left - 12), y: Math.max(0, top - 12), width: el.offsetWidth + 24, height: el.offsetHeight + 24 };
  })()`);
  await sleep(300);
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: box ? { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } : undefined
  });
  fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot:', SHOT, fs.statSync(SHOT).size, JSON.stringify(box));
}

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 2)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
