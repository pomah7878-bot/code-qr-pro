import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2] || '';
const OUT = 'docs/mobile';
const PORT = 9971;
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mobaudit-'));
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

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true });
await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
if (TOKEN) await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

const pages = [
  ['landing', '/'],
  ['pricing', '/pricing'],
  ['login', '/login'],
  ['overview', '/app'],
  ['billing', '/app/billing'],
  ['generate', '/app/generate'],
  ['reprint', '/app/reprint'],
  ['history', '/app/history'],
  ['labels', '/app/labels'],
  ['sets', '/app/sets'],
  ['cz', '/app/cz'],
  ['assistant', '/app/assistant'],
  ['help', '/app/help'],
  ['security', '/app/security'],
  ['apikeys', '/app/apikeys']
];

const report = [];
for (const [name, url] of pages) {
  await send('Page.navigate', { url: BASE + url });
  await sleep(1600);
  await evaluate(`(() => {
    const st = document.createElement('style');
    st.textContent = '*{animation:none!important;transition:none!important} .reveal{opacity:1!important;transform:none!important;filter:none!important}';
    document.head.appendChild(st);
    return 1;
  })()`);
  await sleep(600);
  const metrics = await evaluate(`(() => {
    const vw = window.innerWidth;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const all = [...document.querySelectorAll('body *')];
    const offenders = all.filter((el) => {
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width > vw + 2 || r.right > vw + 4 || r.left < -4;
    }).slice(0, 6).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 70),
        w: Math.round(r.width),
        left: Math.round(r.left),
        right: Math.round(r.right)
      };
    });
    const smallButtons = all.filter((el) => {
      if (!['BUTTON', 'A'].includes(el.tagName)) return false;
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.height < 30 || r.width < 24);
    }).length;
    const bodyText = (document.body.innerText || '');
    return JSON.stringify({
      title: bodyText.split('\\n').find((l) => l.trim())?.slice(0, 40) || '',
      vw,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders,
      smallButtons,
      hasHorizontalScroll: document.documentElement.scrollWidth > vw + 2
    });
  })()`);
  let data = {};
  try { data = JSON.parse(metrics); } catch { data = {}; }
  report.push({ page: name, url, ...data });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(`${name}: overflow=${data.hasHorizontalScroll ? 'YES ' + data.scrollWidth : 'no'} offenders=${data.offenders?.length || 0} small=${data.smallButtons}`);
  for (const o of (data.offenders || []).slice(0, 3)) {
    console.log(`   · <${o.tag} class="${o.cls}"> w=${o.w} left=${o.left} right=${o.right}`);
  }
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('\nconsole errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 4)));
console.log('screenshots:', OUT);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
