import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const PORT = 9731;
const CODE = '0104638230913287215Xk!ABCdef';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-printpage-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 240));
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return `EXCEPTION: ${r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/reprint` });
await sleep(2500);

console.log('print page e2e:', await evaluate(`(async () => {
  const body = {
    template: { name: 'QA print', widthMm: 58, heightMm: 40, dpi: 203, elements: [{ id: 'dm', type: 'datamatrix', x: 2, y: 2, w: 30, h: 30 }] },
    rows: [{ code: ${JSON.stringify(CODE)} }],
    source: 'reprint'
  };
  const res = await fetch('/api/labels/print', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const html = await res.text();
  // в headless window.open без жеста блокируется — пишем страницу в iframe (CSP наследуется от приложения)
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:480px;height:760px;';
  document.body.appendChild(frame);
  const w = frame.contentWindow;
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => setTimeout(r, 1200));
  const hasScript = !!doc.querySelector('script[src="/print-tools.js"]');
  const printBtn = doc.querySelector('[data-print]');
  const closeBtn = doc.querySelector('[data-close]');
  const ready = w.__cqPrintReady === true;
  w.__printed = 0;
  w.print = () => { w.__printed += 1; };
  if (printBtn) printBtn.click();
  await new Promise((r) => setTimeout(r, 400));
  const bar = doc.querySelector('.bar');
  const barStyles = bar ? getComputedStyle(bar).display : null;
  const pageRule = (html.match(/@page\\s*\\{[^}]*\\}/) || [])[0] || null;
  const result = {
    status: res.status,
    contentType: res.headers.get('content-type'),
    hasScript,
    ready,
    hasPrintBtn: !!printBtn,
    hasCloseBtn: !!closeBtn,
    printed: w.__printed,
    pageRule,
    labelsCount: doc.querySelectorAll('.label').length,
    barDisplay: barStyles
  };
  frame.remove();
  return JSON.stringify(result);
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 4)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
