import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const CLIENT_ID = process.argv[3];
const SHOT = process.argv[4] || '';
const PORT = 9511;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ailtr-'));
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
const waitFor = async (expression, timeoutMs = 20000) => {
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
await send('Page.navigate', { url: `${BASE}/app/admin/users/${CLIENT_ID}` });
await waitFor(`[...document.querySelectorAll('button')].some((b) => /Написать клиенту/.test(b.textContent))`);
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Написать клиенту/.test(x.textContent));
  if (b) b.click();
  return 1;
})()`);
await sleep(1500);
await evaluate(`(() => {
  const note = document.querySelector('[role="dialog"] textarea');
  if (!note) return 0;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(note, 'Клиент не мог войти, мы разблокировали вход и сбросили 2FA');
  note.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await sleep(400);
await evaluate(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Сформировать письмо/.test(x.textContent));
  if (b) b.click();
  return 1;
})()`);
await sleep(32000);

console.log('letter:', await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return JSON.stringify({ dialog: false });
  const subject = dialog.querySelector('#mail-subject')?.value || '';
  const areas = [...dialog.querySelectorAll('textarea')];
  const text = areas[areas.length - 1]?.value || '';
  return JSON.stringify({ subject, textLength: text.length, hasMaskedEmail: /\\*+@/.test(text), preview: text.slice(0, 200) });
})()`));

if (SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot:', SHOT, fs.statSync(SHOT).size);
}
console.log('console errors:', consoleErrors.length);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
