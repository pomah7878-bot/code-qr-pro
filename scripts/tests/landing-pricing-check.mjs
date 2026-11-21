import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const PORT = 9941;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-landing-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1500,1400', 'about:blank'], { stdio: 'ignore' });
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
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 160));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, timeoutMs = 25000) => { const t = Date.now(); while (Date.now() - t < timeoutMs) { if (await evaluate(expr)) return true; await sleep(400); } return false; };

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/' });
await waitFor("(document.body.innerText || '').includes('Выберите свой тариф')");
await sleep(1200);
const text = (await evaluate("document.body.innerText || ''")).replace(/\u00a0/g, ' ');
const checks = [];
const ok = (name, cond, extra = '') => { checks.push(Boolean(cond)); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };
ok('Лендинг: блок тарифов', text.includes('Выберите свой тариф'));
ok('4 тарифа: FREE/START/PRO/BUSINESS', ['FREE', 'START', 'PRO', 'BUSINESS'].every((x) => text.includes(x)));
ok('Цены 0/149/349/799', ['0 ₽', '149', '349', '799'].every((x) => text.includes(x)));
ok('Переключатель Месяц/Год', text.includes('Месяц') && text.includes('Год'));
ok('Нет старого «PREMIUM»', !text.includes('PREMIUM'));
ok('Есть «Рекомендуем»', text.toLowerCase().includes('рекомендуем'));
ok('Ссылка сравнить тарифы', text.includes('Сравнить все тарифы'));
// переключаем на год
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Год')); if (b) b.click(); return 1; })()`);
await sleep(700);
const yearText = (await evaluate("document.body.innerText || ''")).replace(/\u00a0/g, ' ');
ok('Годовые цены 1490/3490/7990', ['1 490', '3 490', '7 990'].every((x) => yearText.includes(x)), yearText.match(/\d[\d\s]*₽/g)?.slice(0, 8).join(', '));
await evaluate(`(() => {
  const st = document.createElement('style');
  st.textContent = '*{animation:none!important;transition:none!important} .reveal{opacity:1!important;transform:none!important;filter:none!important}';
  document.head.appendChild(st);
  const el = document.getElementById('pricing');
  if (el) window.scrollTo(0, el.offsetTop - 10);
  return 1;
})()`);
await sleep(1500);
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('docs/landing-pricing.png', Buffer.from(r.result.data, 'base64'));
console.log('screenshot: docs/landing-pricing.png', fs.statSync('docs/landing-pricing.png').size);
console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));
console.log(`итог: ${checks.length - checks.filter((x) => !x).length}/${checks.length}`);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(checks.some((x) => !x) ? 1 : 0);
