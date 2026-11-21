import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const PORT = 10111;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-public-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
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
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 140));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, timeoutMs = 25000) => { const t = Date.now(); while (Date.now() - t < timeoutMs) { if (await ev(expr)) return true; await sleep(300); } return false; };
const checks = [];
const ok = (name, cond, extra = '') => { checks.push(Boolean(cond)); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join('docs', name), Buffer.from(r.result.data, 'base64'));
  console.log('screenshot:', name);
};
async function go(url) {
  await send('Page.navigate', { url: BASE + url });
  await sleep(1700);
}

await send('Runtime.enable');
await send('Page.enable');

// 1) Статьи: список, поиск, переход в статью
await go('/articles');
await waitFor("document.querySelectorAll('a[href^=\"/articles/\"]').length >= 10");
const list = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('a[href^="/articles/"]')];
  return JSON.stringify({ cards: cards.length, firstHref: cards[0]?.getAttribute('href') || '', title: document.title,
    robots: document.head.querySelector('meta[name="robots"]')?.content || '', canonical: document.head.querySelector('link[rel="canonical"]')?.href || '',
    footers: document.querySelectorAll('footer').length, headers: document.querySelectorAll('header').length,
    navText: [...document.querySelectorAll('nav a')].map((a) => a.textContent.trim()).join(' | ') });
})()`));
ok('Статьи: список загрузился', list.cards >= 20, `карточек ${list.cards}`);
ok('Статьи: один header и один footer', list.headers === 1 && list.footers === 1, JSON.stringify({ h: list.headers, f: list.footers }));
ok('Статьи: SEO index + canonical', list.robots.includes('index') && list.canonical.endsWith('/articles'), list.robots);
ok('Статьи: публичная навигация', /Тарифы/.test(list.navText) && /Статьи/.test(list.navText) && /Вопросы/.test(list.navText), list.navText);
await shot('articles-page.png');

// поиск
await ev(`(() => { const i = document.querySelector('input[type="search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'DataMatrix'); i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await sleep(500);
const filteredCount = await ev(`document.querySelectorAll('a[href^="/articles/"]').length`);
ok('Статьи: поиск фильтрует', filteredCount > 0 && filteredCount < list.cards, `после поиска ${filteredCount}`);

// статья
await go(list.firstHref);
await sleep(1200);
const article = JSON.parse(await ev(`(() => JSON.stringify({ title: document.querySelector('h1')?.textContent.trim() || '', text: (document.querySelector('article')?.innerText || '').length, crumbs: document.body.innerText.includes('Все статьи') }))()`));
ok('Статья: заголовок и текст', article.title.length > 3 && article.text > 500, JSON.stringify({ title: article.title, len: article.text }));
ok('Статья: хлебные крошки', article.crumbs === true);

// 2) FAQ: вопросы и раскрытие ответа, JSON-LD
await go('/faq');
await waitFor("document.querySelectorAll('button').length > 20");
const faq = JSON.parse(await ev(`(() => {
  const buttons = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim().length > 15);
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join('');
  return JSON.stringify({ questions: buttons.length, ld: ld.includes('FAQPage'), robots: document.head.querySelector('meta[name="robots"]')?.content || '', title: document.title });
})()`));
ok('FAQ: вопросы отображаются', faq.questions >= 25, `вопросов ${faq.questions}`);
ok('FAQ: JSON-LD FAQPage', faq.ld === true);
ok('FAQ: SEO index', faq.robots.includes('index'), faq.robots);
const before = await ev("document.body.innerText.includes('Короткие ответы')");
await ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').includes('банковская карта')); if(b)b.click(); return 1; })()`);
await sleep(400);
const answer = await ev("document.body.innerText.includes('Карта понадобится только') || document.body.innerText.includes('Зарегистрируйтесь и работайте')");
ok('FAQ: ответ раскрывается', before && answer);
await shot('faq-page.png');

// 3) Юридические документы
const legal = [
  ['/offer', 'Публичная оферта', 'ИНН 504706547269', 'Возврат денежных средств'],
  ['/terms', 'Пользовательское соглашение', 'API и интеграции', 'Допустимое использование'],
  ['/privacy', 'Политика обработки персональных данных', '152-ФЗ', 'Права субъекта данных']
];
for (const [url, title, marker, section] of legal) {
  await go(url);
  await sleep(900);
  const d = JSON.parse(await ev(`(() => JSON.stringify({
    title: document.querySelector('h1')?.textContent.trim() || '',
    sections: document.querySelectorAll('article section').length,
    len: (document.querySelector('article')?.innerText || '').length,
    text: document.querySelector('article')?.innerText || '',
    toc: document.querySelectorAll('aside nav a').length,
    robots: document.head.querySelector('meta[name="robots"]')?.content || ''
  }))()`));
  ok(`${title}: заголовок`, d.title === title, d.title);
  ok(`${title}: разделы и содержание`, d.sections >= 8 && d.toc >= 8, `sections=${d.sections} toc=${d.toc}`);
  ok(`${title}: полный текст`, d.len > 5000, `${d.len} символов`);
  ok(`${title}: ключевой раздел`, d.text.includes(section));
  ok(`${title}: реквизиты/маркер`, d.text.includes(marker) || (url === '/privacy' && d.text.includes('152-ФЗ')));
  ok(`${title}: SEO index`, d.robots.includes('index'), d.robots);
  if (url === '/offer') await shot('legal-offer.png');
}

// 4) Мобильная версия
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/articles');
await sleep(1200);
const mobile = JSON.parse(await ev(`(() => JSON.stringify({ vw: innerWidth, sw: document.documentElement.scrollWidth, cards: document.querySelectorAll('a[href^="/articles/"]').length }))()`));
ok('Мобильные статьи: без горизонтальной прокрутки', mobile.sw <= mobile.vw + 1, JSON.stringify(mobile));
await go('/privacy');
await sleep(1000);
const mobileLegal = JSON.parse(await ev(`(() => JSON.stringify({ vw: innerWidth, sw: document.documentElement.scrollWidth }))()`));
ok('Мобильная политика: без горизонтальной прокрутки', mobileLegal.sw <= mobileLegal.vw + 1, JSON.stringify(mobileLegal));

// 5) Главная и тарифы: футер, навигация, отсутствие дублей
await go('/');
await sleep(1200);
const landing = JSON.parse(await ev(`(() => JSON.stringify({
  footers: document.querySelectorAll('footer').length,
  headers: document.querySelectorAll('header').length,
  footerText: document.querySelector('footer')?.innerText || '',
  navText: [...document.querySelectorAll('header nav a')].map((a) => a.textContent.trim()).join(' | '),
  faqLink: document.body.innerText.includes('Все ответы на вопросы')
}))()`));
ok('Главная: один footer/header', landing.footers === 1 && landing.headers === 1, JSON.stringify({ h: landing.headers, f: landing.footers }));
ok('Главная: документы в футере', landing.footerText.includes('Публичная оферта') && landing.footerText.includes('Политика обработки персональных данных'));
ok('Главная: ссылка на все вопросы', landing.faqLink === true);
ok('Главная: публичная навигация', /Тарифы/.test(landing.navText) && /Статьи/.test(landing.navText), landing.navText);
await go('/pricing');
await sleep(1500);
const pricing = JSON.parse(await ev(`(() => JSON.stringify({
  title: document.querySelector('h1')?.textContent.trim() || '',
  plans: document.body.innerText.includes('START') && document.body.innerText.includes('PRO') && document.body.innerText.includes('BUSINESS'),
  footer: (document.querySelector('footer')?.innerText || '').includes('Публичная оферта')
}))()`));
ok('Тарифы: страница и 4 тарифа', pricing.title.includes('Тарифы') && pricing.plans === true, JSON.stringify(pricing));
ok('Тарифы: документы в футере', pricing.footer === true);

// 6) Футер с документами
await go('/articles');
const footer = await ev("document.querySelector('footer')?.innerText || ''");
ok('Футер: все документы', ['Публичная оферта', 'Пользовательское соглашение', 'Политика обработки персональных данных'].every((x) => footer.includes(x)));
ok('Футер: контакты и реквизиты по ссылке', footer.includes('code-qr-pro@mail.ru') && footer.includes('Реквизиты и документы'));

console.log('\nconsole errors:', errors.length, JSON.stringify(errors.slice(0, 4)));
const failed = checks.filter((x) => !x).length;
console.log(`итог: ${checks.length - failed}/${checks.length}`);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed ? 1 : 0);
