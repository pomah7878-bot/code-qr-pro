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
const PORT = MODE === 'ios' ? 9351 : 9352;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-print-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox',
  '--window-size=412,915',
  `--user-agent=${UA}`,
  'about:blank'
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
const pageErrors = [];
const popups = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(String(msg.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  }
  if (msg.method === 'Page.windowOpen') popups.push(msg.params.url || 'about:blank');
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Network.setCookie', {
  name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax'
});
await send('Page.navigate', { url: `${BASE}/app/reprint` });
await sleep(5000);

console.log(`[${MODE}] path:`, await evaluate('location.pathname'));
console.log(`[${MODE}] me in page:`, await evaluate(`fetch('/api/me', { credentials: 'include' }).then((r) => r.json()).then((d) => JSON.stringify({ plan: d.plan?.id, labelEditor: d.plan?.labelEditor, email: d.user?.email, id: d.user?.id })).catch((e) => 'ERR ' + e.message)`));
console.log(`[${MODE}] buttons:`, await evaluate(`JSON.stringify([...document.querySelectorAll('button')].map((b) => b.textContent.trim() + (b.disabled ? '[d]' : '')))`));

await evaluate(`(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'no-textarea';
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set;
  setter.call(ta, '(01)04638230913287(21)ABC123(91)ABCD(92)XYZ987');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await sleep(400);

// Верификация кодов (JS-клик: сетевой запрос не требует user activation).
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Проверить коды/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(4000);
console.log(`[${MODE}] verify:`, await evaluate(`(() => {
  const l = (document.body.innerText || '').split('\\n').map((s) => s.trim());
  return JSON.stringify(l.filter((s) => /^Проверено \\d|Коды не распознаны/.test(s)).slice(0, 2));
})()`));

const before = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).length;

// Настоящий тап по «Печать».
const box = await evaluate(`(async () => {
  const b = [...document.querySelectorAll('button')].find((x) => /^Печать/.test(x.textContent.trim()));
  if (!b) return null;
  b.scrollIntoView({ block: 'center', behavior: 'instant' });
  window.scrollBy(0, 0);
  await new Promise((r) => setTimeout(r, 600));
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled, vh: window.innerHeight });
})()`);
console.log(`[${MODE}] print box:`, box);

if (box) {
  const { x, y } = JSON.parse(box);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(7000);
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
console.log(`[${MODE}] targets before/after:`, before, list.length);
for (const tg of list.filter((x) => /^https?:/.test(String(x.url)))) console.log('  page target:', tg.type, String(tg.url).slice(0, 100));
console.log(`[${MODE}] windowOpen events:`, JSON.stringify(popups.slice(0, 3)));
console.log(`[${MODE}] notice:`, await evaluate(`(() => {
  const l = (document.body.innerText || '').split('\\n').map((s) => s.trim());
  return JSON.stringify(l.filter((s) => /окно печати|Ошибка|ошибк|тариф|Разрешите/i.test(s)).slice(0, 3));
})()`));
console.log(`[${MODE}] errors:`, consoleErrors.length, pageErrors.length);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
