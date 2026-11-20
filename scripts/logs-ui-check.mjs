import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9741;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-logsui-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = [];
ws.onmessage = async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push({ type: msg.params.type, message: msg.params.message });
    await send('Page.handleJavaScriptDialog', { accept: true });
  }
};
const dialogs = [];
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
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', file, fs.statSync(file).size);
};

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/admin/logs` });
await waitFor(`(document.body.innerText || '').includes('Журнал ошибок')`);
await sleep(1500);

console.log('buttons:', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim()).filter((t) => /Очистить|CSV|Обновить/.test(t)))`));
console.log('total before:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const m = t.match(/всего за \\d+ дн\\.: (\\d+)/);
  return m ? Number(m[1]) : null;
})()`));

await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Очистить всё');
  if (btn) btn.click();
  return 1;
})()`);
await sleep(2500);
console.log('dialogs:', JSON.stringify(dialogs));
console.log('after clear:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    total: (t.match(/всего за \\d+ дн\\.: (\\d+)/) || [])[1] || null,
    notice: (t.match(/Журнал очищен[^\\n]*/) || [])[0] || null,
    emptyRow: t.includes('Записей нет')
  });
})()`));
if (SHOT) await shot(SHOT);

console.log('detail delete button:', await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('tbody tr')];
  return JSON.stringify({ rows: rows.length });
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
