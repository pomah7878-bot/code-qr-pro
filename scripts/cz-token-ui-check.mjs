import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9781;
const CODE = '010301762042200321ABC123';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-czui-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1400', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return `EXCEPTION: ${r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};
const waitFor = async (expr, timeoutMs = 30000) => {
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
await send('Page.navigate', { url: `${BASE}/app/reprint` });
await waitFor(`!!document.querySelector('textarea')`);
await sleep(1500);

await evaluate(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(CODE)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await sleep(600);
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Проверить коды');
  if (btn && !btn.disabled) btn.click();
  return 1;
})()`);
await waitFor(`(document.body.innerText || '').includes('Карточка товара по коду')`, 40000);
await sleep(2500);

console.log('token input present:', await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('токен True API'));
  return JSON.stringify({ found: Boolean(input), type: input ? input.type : null });
})()`));
console.log('open source card:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({ nutella: t.includes('Nutella'), off: /OPEN FOOD FACTS/i.test(t) });
})()`));

// вставляем заведомо неверный токен
await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('токен True API'));
  if (!input) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'invalid-test-token-0000000000000000');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Подключить');
  if (btn) btn.click();
  return 'clicked';
})()`);
await sleep(6000);
console.log('after invalid token:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    czConnected: t.includes('ЧЗ подключён'),
    czErrorShown: /Токен не действителен/.test(t),
    snippet: (t.match(/Токен не действителен[^\\n]*/) || [])[0] || null
  });
})()`));

if (SHOT) {
  await evaluate(`(() => {
    const el = [...document.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('Карточка товара'));
    if (el) el.scrollIntoView({ block: 'center' });
    return 1;
  })()`);
  await sleep(700);
  await shot(SHOT);
}

// отключаем токен обратно
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Отключить');
  if (btn) btn.click();
  return 1;
})()`);
await sleep(2500);
console.log('token cleared:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({ hasInputAgain: [...document.querySelectorAll('input')].some((i) => (i.placeholder || '').includes('токен True API')) });
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
