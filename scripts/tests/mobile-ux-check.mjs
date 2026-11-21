import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2] || '';
const PORT = 9981;
const OUT = 'docs/mobile';
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mobux-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
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
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 140));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, timeoutMs = 20000) => { const t = Date.now(); while (Date.now() - t < timeoutMs) { if (await evaluate(expr)) return true; await sleep(350); } return false; };
const checks = [];
const ok = (name, cond, extra = '') => { checks.push(Boolean(cond)); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true });
await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
if (TOKEN) await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

async function goto(url, waitExpr) {
  await send('Page.navigate', { url: BASE + url });
  await sleep(1600);
  if (waitExpr) await waitFor(waitExpr);
  await evaluate(`(() => { const st = document.createElement('style'); st.textContent = '*{animation:none!important;transition:none!important} .reveal{opacity:1!important;transform:none!important;filter:none!important}'; document.head.appendChild(st); return 1; })()`);
  await sleep(400);
}

// 1) Главная: CTA виден на первом экране, декор скрыт
await goto('/', "(document.body.innerText || '').includes('Коды')");
const hero = JSON.parse(await evaluate(`(() => {
  const btn = [...document.querySelectorAll('a,button')].find((b) => (b.textContent || '').includes('Начать бесплатно'));
  const r = btn ? btn.getBoundingClientRect() : null;
  const qr = document.querySelector('section img[alt="CODE QR PRO"]');
  const qrVisible = qr ? getComputedStyle(qr.closest('.reveal')).display !== 'none' && qr.getBoundingClientRect().height > 0 : false;
  return JSON.stringify({ ctaTop: r ? Math.round(r.top) : null, ctaBottom: r ? Math.round(r.bottom) : null, vh: window.innerHeight, qrVisible, scrollWidth: document.documentElement.scrollWidth, vw: innerWidth });
})()`));
ok('Главная: CTA в первом экране', hero.ctaTop != null && hero.ctaBottom <= hero.vh, `bottom=${hero.ctaBottom} vh=${hero.vh}`);
ok('Главная: декоративный QR скрыт на телефоне', hero.qrVisible === false);
ok('Главная: нет горизонтальной прокрутки', hero.scrollWidth <= hero.vw + 1);
await shot('landing.png');

// 2) Подсказки свёрнуты и раскрываются
const pages = [['generate', '/app/generate', 'Генерация'], ['reprint', '/app/reprint', 'Повторная'], ['labels', '/app/labels', 'Редактор']];
for (const [name, url, title] of pages) {
  await goto(url, `(document.body.innerText || '').includes('${title}')`);
  const state = JSON.parse(await evaluate(`(() => {
    const toggles = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === 'Показать шаги');
    const guide = [...document.querySelectorAll('.glass')].find((el) => (el.textContent || '').includes('Показать шаги'));
    const steps = guide ? guide.querySelector('ol') : null;
    return JSON.stringify({
      toggle: toggles.length,
      stepsVisible: steps ? steps.getBoundingClientRect().height > 0 : null,
      guideHeight: guide ? Math.round(guide.getBoundingClientRect().height) : null
    });
  })()`));
  ok(`${name}: подсказка свёрнута`, state.toggle > 0 && state.stepsVisible === false, JSON.stringify(state));
  const click = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Показать шаги'); if (!b) return false; b.click(); return true; })()`);
  await sleep(350);
  const expanded = JSON.parse(await evaluate(`(() => {
    const guide = [...document.querySelectorAll('.glass')].find((el) => (el.textContent || '').includes('Показать шаги') || (el.textContent || '').includes('Свернуть'));
    const steps = guide ? guide.querySelector('ol') : null;
    return JSON.stringify({ stepsVisible: steps ? steps.getBoundingClientRect().height > 0 : null });
  })()`));
  ok(`${name}: подсказка раскрывается`, click && expanded.stepsVisible === true);
  await shot(`${name}.png`);
}

// 3) Навигация: активный пункт виден
await goto('/app/billing', "(document.body.innerText || '').includes('Моя подписка')");
const nav = JSON.parse(await evaluate(`(() => {
  const active = document.querySelector('nav .router-link-active');
  const r = active ? active.getBoundingClientRect() : null;
  return JSON.stringify({ left: r ? Math.round(r.left) : null, right: r ? Math.round(r.right) : null, vw: innerWidth });
})()`));
ok('Навигация: активная вкладка в экране', nav.left != null && nav.left >= -2 && nav.right <= nav.vw + 2, JSON.stringify(nav));
await shot('billing.png');

// 4) AI-кнопка не перекрывает последний блок при прокрутке вниз
await evaluate('window.scrollTo(0, document.body.scrollHeight)');
await sleep(700);
const overlap = JSON.parse(await evaluate(`(() => {
  const launcher = document.querySelector('.ai-launcher');
  const main = document.querySelector('main');
  const last = main ? [...main.querySelectorAll('section > *')].filter((el) => el.getBoundingClientRect().height > 20).pop() : null;
  const lr = launcher ? launcher.getBoundingClientRect() : null;
  const mr = last ? last.getBoundingClientRect() : null;
  return JSON.stringify({ launcherTop: lr ? Math.round(lr.top) : null, lastBottom: mr ? Math.round(mr.bottom) : null });
})()`));
ok('AI-кнопка не перекрывает контент (есть отступ)', overlap.launcherTop == null || overlap.lastBottom == null || overlap.lastBottom <= overlap.launcherTop, JSON.stringify(overlap));

// 5) Меню-бургер открывается
await goto('/app', "(document.body.innerText || '').includes('Обзор')");
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('меню')); if (b) b.click(); return 1; })()`);
await sleep(400);
const menuText = await evaluate("document.body.innerText || ''");
ok('Меню-бургер открывает пункты', menuText.includes('Кабинет') && menuText.includes('Выйти'));

// 6) Страница тарифов: карточки не шире экрана
await goto('/pricing', "(document.body.innerText || '').includes('Тарифы CODE QR PRO')");
const pricing = JSON.parse(await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.glass')].filter((el) => /FREE|START|PRO|BUSINESS/.test(el.textContent || ''));
  const widths = cards.slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().width));
  return JSON.stringify({ widths, vw: innerWidth, scrollWidth: document.documentElement.scrollWidth });
})()`));
ok('Тарифы: карточки в пределах экрана', pricing.widths.every((w) => w <= pricing.vw) && pricing.scrollWidth <= pricing.vw + 1, JSON.stringify(pricing));

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 4)));
const failed = checks.filter((x) => !x).length;
console.log(`итог: ${checks.length - failed}/${checks.length}`);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed ? 1 : 0);
