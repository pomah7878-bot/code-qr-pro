import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const OUT = 'docs';
const PORT = 9951;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-width-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
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
const checks = [];
const ok = (name, cond, extra = '') => { checks.push(Boolean(cond)); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };

await send('Runtime.enable');
await send('Page.enable');

async function measure(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url: BASE + '/' });
  await waitFor("(document.body.innerText || '').includes('Выберите свой тариф')");
  await evaluate(`(() => {
    const st = document.createElement('style');
    st.textContent = '*{animation:none!important;transition:none!important} .reveal{opacity:1!important;transform:none!important;filter:none!important}';
    document.head.appendChild(st);
    return 1;
  })()`);
  await sleep(900);
  return evaluate(`(() => {
    const pricing = document.getElementById('pricing');
    const cards = [...document.querySelectorAll('#pricing .glass')];
    const widths = cards.map((c) => Math.round(c.getBoundingClientRect().width));
    const header = document.querySelector('header > div');
    return JSON.stringify({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      pricingWidth: pricing ? Math.round(pricing.getBoundingClientRect().width) : 0,
      cardWidths: widths,
      cardsPerRow: (() => {
        if (!cards.length) return 0;
        const top = Math.round(cards[0].getBoundingClientRect().top);
        return cards.filter((c) => Math.round(c.getBoundingClientRect().top) === top).length;
      })(),
      headerWidth: header ? Math.round(header.getBoundingClientRect().width) : 0
    });
  })()`);
}

const desktop = JSON.parse(await measure(1920, 1080));
console.log('desktop:', JSON.stringify(desktop));
ok('Нет горизонтальной прокрутки (1920)', desktop.scrollWidth <= desktop.viewport + 1, `scroll=${desktop.scrollWidth}`);
ok('Контейнер главной шире 1500px', desktop.pricingWidth >= 1500, `pricing=${desktop.pricingWidth}`);
ok('4 карточки в один ряд', desktop.cardsPerRow === 4, `perRow=${desktop.cardsPerRow} widths=${desktop.cardWidths.join('/')}`);
ok('Карточки шире 300px', desktop.cardWidths.every((w) => w >= 300), desktop.cardWidths.join('/'));
ok('Шапка выровнена по контейнеру', Math.abs(desktop.headerWidth - desktop.pricingWidth) <= 40, `header=${desktop.headerWidth}`);

// скриншот тарифов на десктопе
await evaluate(`(() => { const el = document.getElementById('pricing'); if (el) window.scrollTo(0, el.offsetTop - 10); return 1; })()`);
await sleep(600);
let shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUT, 'landing-wide.png'), Buffer.from(shot.result.data, 'base64'));
console.log('screenshot: docs/landing-wide.png');

const mobile = JSON.parse(await measure(390, 844));
console.log('mobile:', JSON.stringify(mobile));
ok('Нет горизонтальной прокрутки (390)', mobile.scrollWidth <= mobile.viewport + 1, `scroll=${mobile.scrollWidth}`);
ok('Мобильные карточки не шире экрана', mobile.cardWidths.every((w) => w <= mobile.viewport), mobile.cardWidths.join('/'));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));
const failed = checks.filter((x) => !x).length;
console.log(`итог: ${checks.length - failed}/${checks.length}`);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed ? 1 : 0);
