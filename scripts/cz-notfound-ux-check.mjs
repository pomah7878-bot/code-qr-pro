import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const PORT = 9821;
const SHOT = process.argv[3] || '';
const GOOD = '0104638230913287215ZsWrd';
const BAD = '0104638230913287215E&co';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-czux-'));
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
const waitFor = async (expr, timeoutMs = 45000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (await evaluate(expr)) return true; await sleep(400); }
  return false;
};

async function checkCode(code, label) {
  await send('Page.navigate', { url: `${BASE}/app/reprint` });
  await waitFor(`!!document.querySelector('textarea')`, 25000);
  await sleep(1200);
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(code)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await sleep(600);
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Проверить коды');
    if (btn && !btn.disabled) btn.click();
    return 1;
  })()`);
  await waitFor(`(document.body.innerText || '').includes('Карточка товара по коду')`, 45000);
  await sleep(4500);
  console.log(`\n--- ${label} ---`);
  console.log(await evaluate(`(() => {
    const t = document.body.innerText || '';
    const i = t.indexOf('Карточка товара по коду');
    return JSON.stringify({
      snippet: i >= 0 ? t.slice(i, i + 330).replace(/\\s+/g, ' ') : '',
      foundCard: /OPEN FOOD|ЧЕСТНЫЙ ЗНАК|ЧЁСТНЫЙ ЗНАК|Национальный каталог/i.test(t.slice(i, i + 700)),
      notFound: /код не найден|не найден в открытых/i.test(t)
    });
  })()`));
  if (SHOT) {
    await evaluate(`(() => {
      const el = [...document.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('Карточка товара'));
      if (el) el.scrollIntoView({ block: 'center' });
      return 1;
    })()`);
    await sleep(700);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOT, Buffer.from(r.result.data, 'base64'));
    console.log('screenshot:', SHOT, fs.statSync(SHOT).size);
  }
}

await send('Runtime.enable');
await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

await checkCode(GOOD, 'известный код (должна быть карточка)');
await checkCode(BAD, 'код, которого нет в ЧЗ (диагностика)');

// проверка UX токена: ввод без сохранения
await send('Page.navigate', { url: `${BASE}/app/reprint` });
await waitFor(`!!document.querySelector('textarea')`, 25000);
await sleep(1200);
await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('токен True API'));
  if (!input) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'invalid-test-token-0000000000000000');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`);
await sleep(800);
console.log('\n--- несохранённый токен ---');
console.log(await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({ hint: /ещё не сохранён/.test(t) });
})()`));

console.log('\nconsole errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
