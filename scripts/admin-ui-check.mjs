import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const CLIENT_ID = process.argv[3];
const PORT = 9361;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-admin-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1000', 'about:blank'
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

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(String(msg.params.exceptionDetails?.exception?.description || '').slice(0, 200));
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
await send('Page.navigate', { url: `${BASE}/app/admin/users/${CLIENT_ID}` });
await sleep(6000);

console.log('path:', await evaluate('location.pathname'));
console.log('has card:', await evaluate(`document.body.innerText.includes('Быстрая помощь')`));
console.log('diag texts:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    locked: t.includes('заблокирован'),
    attempts: /неудачных попыток: \\d+/.test(t),
    codesToday: t.includes('Коды сегодня'),
    linkBtn: t.includes('Ссылка для входа')
  });
})()`));

// Клик «Ссылка для входа» (админский POST не требует user activation).
console.log('click link:', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Ссылка для входа/.test(x.textContent));
  if (!b) return 'not-found';
  if (b.disabled) return 'disabled';
  b.click();
  return 'clicked';
})()`));
await sleep(3500);
console.log('modal:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const m = t.match(/https:\\/\\/\\S+\\/api\\/auth\\/link\\/[a-f0-9]+/);
  return JSON.stringify({ modalOpen: t.includes('Ссылка для входа') && t.includes('Копировать'), url: m ? m[0].slice(0, 60) + '…' : null });
})()`));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));
console.log('page errors:', pageErrors.length, JSON.stringify(pageErrors.slice(0, 3)));

// Закрываем модалку и проверяем разблокировку входа.
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(600);
console.log('click unlock:', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Разблокировать вход/.test(x.textContent));
  if (!b) return 'not-found';
  if (b.disabled) return 'disabled';
  b.click();
  return 'clicked';
})()`));
await sleep(3500);
console.log('after unlock:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  const line = t.split('\\n').map((s) => s.trim()).find((s) => /Вход разблокирован|неудачных попыток: 0|открыт/.test(s));
  return line || 'no-notice';
})()`));

// Проверяем карточку защитных лимитов в настройках.
await send('Page.navigate', { url: `${BASE}/app/admin/settings` });
await sleep(5000);
console.log('settings card:', await evaluate(`(() => {
  const t = document.body.innerText || '';
  return JSON.stringify({
    card: t.includes('Защитные лимиты'),
    limits: t.includes('Лимит запросов'),
    locks: t.includes('Блокировки входа')
  });
})()`));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
