import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const EMAIL = process.argv[2];
const PASS = process.argv[3];
const MODE = process.argv[4] === 'ios' ? 'ios' : 'android';
const UA = MODE === 'ios'
  ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const PORT = MODE === 'ios' ? 9336 : 9337;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mob-'));
const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-dl-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: EMAIL, password: PASS })
});
const loginBody = await loginRes.json().catch(() => ({}));
const token = /cq_session=([^;]+)/.exec(loginRes.headers.get('set-cookie') || '')?.[1];
console.log(`[${MODE}] login api:`, loginRes.status, 'cookie:', token ? 'yes' : 'no', 'plan:', loginBody?.user?.plan || '-');
if (!token) {
  console.log('login body:', JSON.stringify(loginBody).slice(0, 200));
  process.exit(1);
}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=412,915',
  `--user-agent=${UA}`,
  'about:blank'
], { stdio: 'ignore' });

async function newTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (res.ok) return res.json();
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('chrome devtools not ready');
}

const target = await newTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];
const downloadsSeen = [];
const apiResponses = [];

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
  if (msg.method === 'Page.downloadWillBegin' || msg.method === 'Browser.downloadWillBegin') {
    downloadsSeen.push(msg.params.suggestedFilename || msg.params.url || 'download');
  }
  if (msg.method === 'Network.responseReceived') {
    const url = msg.params.response?.url || '';
    if (url.includes('/api/')) apiResponses.push(`${msg.params.response.status} ${url.split('?')[0].replace(BASE, '')}`);
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
await send('Network.enable');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
await send('Network.setCookie', {
  name: 'cq_session', value: token, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax'
});

await send('Page.navigate', { url: `${BASE}/app/reprint` });
await sleep(5000);

console.log(`[${MODE}] page:`, await evaluate(`JSON.stringify({
  path: location.pathname,
  ua: /Android/i.test(navigator.userAgent) ? 'android' : (/iPhone/.test(navigator.userAgent) ? 'ios' : 'other'),
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /PDF|Печать|Проверить/.test(t))
})`));

console.log(`[${MODE}] set codes:`, await evaluate(`(async () => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'no-textarea';
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set;
  setter.call(ta, '(01)04638230913287(21)ABC123(91)ABCD(92)XYZ987');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const btn = [...document.querySelectorAll('button')].find((b) => /^PDF/.test(b.textContent.trim()));
  return 'len=' + ta.value.length + ' btn=' + (btn ? btn.textContent.trim() + (btn.disabled ? '[disabled]' : '') : 'none');
})()`));

console.log(`[${MODE}] click Проверить:`, await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Проверить коды/.test(x.textContent));
  if (!b) return 'not-found';
  b.click();
  return 'clicked';
})()`));
await sleep(4000);
console.log(`[${MODE}] verify notice:`, await evaluate(`(() => {
  const lines = (document.body.innerText || '').split('\\n').map((s) => s.trim());
  return JSON.stringify(lines.filter((s) => /^Проверено \\d|валидных|не распознаны|Коды не распознаны/i.test(s)).slice(0, 3));
})()`));

const targetsBefore = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).length;
console.log(`[${MODE}] click PDF:`, await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^PDF/.test(x.textContent.trim()));
  if (!b) return 'not-found';
  if (b.disabled) return 'disabled';
  b.click();
  return 'clicked';
})()`));
await sleep(12000);

const files = fs.readdirSync(downloads).map((f) => `${f} (${fs.statSync(path.join(downloads, f)).size} bytes)`);
console.log(`[${MODE}] api:`, JSON.stringify(apiResponses.slice(-8)));
console.log(`[${MODE}] downloads:`, JSON.stringify(downloadsSeen.slice(0, 5)));
console.log(`[${MODE}] files:`, JSON.stringify(files));
console.log(`[${MODE}] path after pdf:`, await evaluate('location.pathname'));
console.log(`[${MODE}] notice:`, await evaluate(`(() => {
  const lines = (document.body.innerText || '').split('\\n').map((s) => s.trim());
  return JSON.stringify(lines.filter((s) => /PDF (готов|открылся)|скачал|Поделиться|Уменьшите|тариф|Ошибка|ошибк/i.test(s)).slice(0, 4));
})()`));
const targetsAfter = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).length;
console.log(`[${MODE}] targets before/after pdf:`, targetsBefore, targetsAfter);
console.log(`[${MODE}] console errors:`, consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 4)));
console.log(`[${MODE}] page errors:`, pageErrors.length, JSON.stringify(pageErrors.slice(0, 4)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
try { fs.rmSync(downloads, { recursive: true, force: true }); } catch { /* ignore */ }
