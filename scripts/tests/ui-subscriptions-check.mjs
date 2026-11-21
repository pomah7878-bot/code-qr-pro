import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const FREE_TOKEN = process.argv[2];
const ADMIN_TOKEN = process.argv[3];
const OUT = process.argv[4] || 'docs';
const PORT = 9931;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-subs-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1500,1200', 'about:blank'], { stdio: 'ignore' });
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
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 180));
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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', file, fs.statSync(file).size);
};

await send('Runtime.enable');
await send('Page.enable');
const results = [];
const ok = (name, cond, extra = '') => { results.push(Boolean(cond)); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };

async function openAs(token, url) {
  await send('Network.setCookie', { name: 'cq_session', value: token, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  await send('Page.navigate', { url });
  await sleep(2200);
}

// 1) Моя подписка
await openAs(FREE_TOKEN, `${BASE}/app/billing`);
await waitFor(`(document.body.innerText || '').includes('Моя подписка')`);
const billingText = await evaluate("document.body.innerText || ''");
ok('Страница «Моя подписка»', billingText.includes('Моя подписка'));
ok('Виден пробный период PRO', billingText.toLowerCase().includes('пробный период pro'));
ok('Видны тарифы START/PRO/BUSINESS', ['START', 'PRO', 'BUSINESS'].every((x) => billingText.includes(x)));
ok('Видны лимиты операций и проверок', billingText.includes('Операции') && billingText.includes('Расширенные проверки'));
ok('Есть переключатель Месяц/Год', billingText.includes('Месяц') && billingText.includes('Год'));
ok('Есть история/оплата', billingText.includes('Оплата через ЮKassa') || billingText.includes('Перейти к оплате'));
await shot('subscription-page.png');

// 1б) Обзор: новые лимиты
await openAs(FREE_TOKEN, BASE + '/app');
await waitFor("(document.body.innerText || '').includes('Обзор')");
await sleep(1200);
const dashText = await evaluate("document.body.innerText || ''");
ok('Обзор: операции за период', dashText.includes('Операций в месяц') || dashText.includes('Использование за период'));
ok('Обзор: ссылка на подписку', dashText.includes('Моя подписка') || dashText.includes('Оформить PRO'));

// 2) Страница тарифов
await openAs(FREE_TOKEN, `${BASE}/pricing`);
await waitFor(`(document.body.innerText || '').includes('Тарифы CODE QR PRO')`);
const pricingText = await evaluate("document.body.innerText || ''");
ok('Публичная страница тарифов', pricingText.includes('Тарифы CODE QR PRO'));
ok('4 тарифа на странице', ['FREE', 'START', 'PRO', 'BUSINESS'].every((x) => pricingText.includes(x)));
ok('Отмечен рекомендуемый PRO', pricingText.includes('РЕКОМЕНДУЕМ'));
ok('Цены 149/349/799', ['149', '349', '799'].every((x) => pricingText.includes(x)));
await shot('pricing-page.png');

// 3) Админка тарифов
await openAs(ADMIN_TOKEN, `${BASE}/app/admin/billing`);
await waitFor(`(document.body.innerText || '').includes('Тарифы и подписки')`);
await sleep(1200);
const adminText = await evaluate("document.body.innerText || ''");
ok('Админка «Тарифы и подписки»', adminText.includes('Тарифы и подписки'));
ok('Вкладки админки', ['Тарифы', 'Подписки', 'Платежи', 'Ошибки и статистика'].every((x) => adminText.includes(x)));
ok('Тарифы загружены в админке', ['FREE', 'START', 'PRO', 'BUSINESS'].every((x) => adminText.includes(x)));
await shot('admin-billing-page.png');

// 4) Повторная печать: серверная проверка кода
await openAs(FREE_TOKEN, `${BASE}/app/reprint`);
await waitFor(`!!document.querySelector('textarea')`);
await sleep(1000);
const CODE = '(01)04638230913287(21)QAUI0001(91)EE12(92)CCCCCCCCCCCC1)'.replace(/\)$/, '');
await evaluate(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify('(01)04638230913287(21)QAUI0001(91)EE12(92)CCCCCCCCCCCC1')});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await sleep(500);
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Проверить коды');
  if (btn && !btn.disabled) btn.click();
  return 1;
})()`);
await waitFor(`(document.body.innerText || '').includes('Карточка товара по коду')`, 45000);
await sleep(4000);
const reprintText = await evaluate("document.body.innerText || ''");
ok('Повторная печать: результаты', reprintText.includes('Результаты проверки'));
ok('Серверная карточка товара (без ошибок)', reprintText.includes('Карточка товара по коду') && !reprintText.includes('Не удалось получить карточку'));
await evaluate(`(() => { const el = [...document.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('Карточка товара')); if (el) el.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(600);
await shot('reprint-server-card.png');

console.log('\nconsole errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 4)));
const failed = results.filter((r) => !r).length;
console.log(`UI тестов: ${results.length}, провалено: ${failed}`);
ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed ? 1 : 0);
