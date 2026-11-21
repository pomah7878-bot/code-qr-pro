import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const PORT = 10071;
const GS = '\u001d';
const FULL = `0104638230913287215ZsWrd${GS}91EE12${GS}92f2+hPGe2ZRc2FmzC1oFm+6Nwt1PxgpCRp9khyOKEEG4w=`;
const SHORT = '(01)03017620422003(21)ABC123';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-open-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1500,1400', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 120));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, timeoutMs = 45000) => { const t = Date.now(); while (Date.now() - t < timeoutMs) { if (await ev(expr)) return true; await sleep(400); } return false; };
const shots = [];
const ok = (name, cond, extra = '') => { shots.push(Boolean(cond)); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };

await send('Runtime.enable'); await send('Page.enable');
await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
await send('Page.navigate', { url: `${BASE}/app/reprint` });
await waitFor("!!document.querySelector('textarea')");
await sleep(1200);
await ev(`document.querySelector('textarea').focus()`);
await send('Input.insertText', { text: `${FULL}\n${SHORT}` });
await sleep(500);
const fieldValue = await ev("document.querySelector('textarea')?.value || ''");
if (!fieldValue) { await send('Input.insertText', { text: `${FULL}\n${SHORT}` }); await sleep(300); }
await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Проверить коды');
  if (btn && !btn.disabled) btn.click();
  return 1;
})()`);
await waitFor("(document.body.innerText || '').includes('Результаты проверки') && (document.body.innerText || '').includes('Карточка товара по коду')", 45000);
await sleep(5000);
const text = (await ev("document.body.innerText || ''")).replace(/\u00a0/g, ' ');
ok('Полный код: дата изготовления 06.08.2026', text.includes('06.08.2026'));
ok('Полный код: годен до 06.08.2028', text.includes('06.08.2028'));
ok('Нет «сырого» timestamp 1785974400', !text.includes('1785974400'));
ok('Нет английского статуса INTRODUCED', !text.includes('INTRODUCED'));
ok('Статус переведён: «В обороте»', /в обороте/i.test(text));
ok('Криптозащита: «Не проверено» (код из примера с невалидным хвостом)', /не проверен/i.test(text));
ok('Срок использования из ГИС МТ', text.includes('2 сут; дн'));
ok('Объём 2 мл', text.includes('2 мл'));
ok('Каталог+OFF: карточка Nutella', text.includes('Nutella') || text.includes('Pâte à tartiner'));
ok('Состав из открытых баз (sugar/palm oil)', /sugar|sucre|состав/i.test(text));
await ev(`(() => { const h=[...document.querySelectorAll('h2,h3')].find((x)=>(x.textContent||'').includes('Результаты проверки')); if (h) h.scrollIntoView({ block: 'start' }); return 1; })()`);
await sleep(700);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('docs/open-sources-fixed.png', Buffer.from(shot.result.data, 'base64'));
console.log('screenshot: docs/open-sources-fixed.png');
console.log('console errors:', errors.length, JSON.stringify(errors.slice(0, 3)));
const failed = shots.filter((x) => !x).length;
console.log(`итог: ${shots.length - failed}/${shots.length}`);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed ? 1 : 0);
