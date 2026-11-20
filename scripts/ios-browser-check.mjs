import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const EMAIL = process.argv[2];
const PASS = process.argv[3];
const PORT = 9333;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ios-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-gpu',
  '--no-sandbox',
  '--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (res.ok) return res.json();
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('chrome devtools not ready');
}

const target = await connect();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];
const netRequests = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || '').slice(0, 300));
  }
  if (msg.method === 'Network.requestWillBeSent') {
    netRequests.push(msg.params.request.url);
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
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');

await send('Page.navigate', { url: `${BASE}/login` });
await sleep(3500);

// Заполняем форму входа нативными сеттерами, чтобы Vue увидел ввод.
const loginResult = await evaluate(`(async () => {
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const email = document.querySelector('input[type=email], input[name=email]');
  const pass = document.querySelector('input[type=password]');
  if (!email || !pass) return 'no-form';
  setValue(email, ${JSON.stringify(EMAIL)});
  setValue(pass, ${JSON.stringify(PASS)});
  await new Promise((r) => setTimeout(r, 300));
  const btn = [...document.querySelectorAll('button')].find((b) => /Войти|Вход/i.test(b.textContent || ''));
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
})()`);
console.log('login:', loginResult);
await sleep(4000);

console.log('url after login:', await evaluate('location.pathname'));

await send('Page.navigate', { url: `${BASE}/app/reprint` });
await sleep(4000);

const pageInfo = await evaluate(`(() => {
  const text = document.body.innerText || '';
  const buttons = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean);
  return JSON.stringify({
    path: location.pathname,
    hasReprintTitle: text.includes('Повторная печать'),
    hasPdfBtn: buttons.some((b) => /PDF/i.test(b)),
    hasPrintBtn: buttons.some((b) => /Печать/i.test(b)),
    buttons: buttons.slice(0, 14)
  });
})()`);
console.log('page:', pageInfo);

// Проверяем, что downloadBlob уйдёт на ticket-эндпоинт при iPhone UA.
const ticketProbe = await evaluate(`(async () => {
  const res = await fetch('/api/labels/pdf/ticket', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template: { name: 'probe', widthMm: 58, heightMm: 40, dpi: 203, elements: [{ id: 'dm', type: 'datamatrix', x: 2, y: 2, w: 30, h: 30 }] },
      rows: [{ code: '0104638230913287215Xk!ABCdef' }],
      single: true,
      source: 'reprint'
    })
  });
  const data = await res.json().catch(() => ({}));
  return JSON.stringify({ status: res.status, url: data.url || null });
})()`);
console.log('ticket probe:', ticketProbe);

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 5)));
console.log('page errors:', pageErrors.length, JSON.stringify(pageErrors.slice(0, 5)));
console.log('ticket requests seen:', netRequests.filter((u) => u.includes('/ticket')).length);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
