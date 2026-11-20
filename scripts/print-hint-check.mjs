import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const MODE = process.argv[3] === 'ios' ? 'ios' : 'android';
const UA = MODE === 'ios'
  ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const PORT = MODE === 'ios' ? 9391 : 9392;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-phint-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=412,915', `--user-agent=${UA}`, 'about:blank'
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
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 160));
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
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/reprint` });
await sleep(5500);

console.log('reprint hint:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({ block: t.includes('Печать с телефона'), airprint: t.includes('AirPrint') });
})()`));
console.log('expand help:', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Печать с телефона/.test(x.textContent));
  if (!b) return 'not-found';
  b.click();
  return 'clicked';
})()`));
await sleep(800);
console.log('help content:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    airprint: t.includes('AirPrint'),
    android: t.includes('Android'),
    mopria: t.includes('Mopria') || t.includes('Default Print Service'),
    size: t.includes('58×40') || t.includes('размер бумаги')
  });
})()`));

// Проверяем печатный документ: в нём должна быть подсказка, скрытая при печати.
console.log('print doc hint:', await evaluate(`fetch('/api/labels/print', {
  method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    template: { name: 'q', widthMm: 58, heightMm: 40, dpi: 203, elements: [{ id: 'dm', type: 'datamatrix', x: 2, y: 2, w: 30, h: 30 }] },
    rows: [{ code: '0104638230913287215Xk!ABCdef' }]
  })
}).then(r => r.text()).then(html => JSON.stringify({
  hasHint: html.includes('Печать с телефона'),
  hasAirprint: html.includes('AirPrint'),
  hiddenInPrint: html.includes('@media print')
})).catch(e => 'ERR ' + e.message)`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

for (const page of ['/app/labels', '/app/sets']) {
  await send('Page.navigate', { url: `${BASE}${page}` });
  await sleep(4500);
  console.log(page, await evaluate(`JSON.stringify({ hint: (document.body.innerText || '').includes('Печать с телефона') })`));
}

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
