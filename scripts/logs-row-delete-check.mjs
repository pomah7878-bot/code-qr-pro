import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const PORT = 9751;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-logrow-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const dialogs = [];
ws.onmessage = async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
    await send('Page.handleJavaScriptDialog', { accept: true });
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return `EXCEPTION: ${r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};
const waitFor = async (expr, timeoutMs = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (await evaluate(expr)) return true; await sleep(400); }
  return false;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/logs` });
await waitFor(`(document.body.innerText || '').includes('Журнал ошибок')`);
await sleep(1500);

console.log('rows before:', await evaluate(`document.querySelectorAll('tbody tr').length`));
console.log('open detail:', await evaluate(`(() => {
  const row = document.querySelector('tbody tr[class*="cursor-pointer"]') || document.querySelector('tbody tr');
  if (row) row.click();
  return 1;
})()`));
await sleep(1200);
console.log('modal buttons:', await evaluate(`JSON.stringify([...document.querySelectorAll('.fixed button, [role="dialog"] button')].map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 12))`));
console.log('click delete:', await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim() === 'Удалить запись');
  if (btn) btn.click();
  return btn ? 'clicked' : 'not-found';
})()`));
await sleep(2200);
console.log('dialogs:', JSON.stringify(dialogs));
console.log('after:', await evaluate(`(() => ({
  rows: document.querySelectorAll('tbody tr').length,
  empty: (document.body.innerText || '').includes('Записей нет'),
  notice: ((document.body.innerText || '').match(/Запись удалена[^\\n]*/) || [])[0] || null
}))()`));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
