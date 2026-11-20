import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9891;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mobscan-'));
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
const waitFor = async (expr, timeoutMs = 35000) => {
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

async function inspect(label, width, height, ua) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: width < 600 });
  if (ua) await send('Network.setUserAgentOverride', { userAgent: ua });
  await send('Page.navigate', { url: `${BASE}/app/reprint` });
  await waitFor(`!!document.querySelector('textarea')`);
  await sleep(1800);
  console.log(`\n--- ${label} ---`);
  console.log(await evaluate(`(() => {
    const isVisible = (el) => el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
    const buttons = [...document.querySelectorAll('button')];
    const byText = (t) => buttons.find((b) => (b.textContent || '').trim() === t);
    const gear = buttons.find((b) => (b.getAttribute('aria-label') || '') === 'Настройки сканера');
    return JSON.stringify({
      camera: isVisible(byText('Камера')),
      comScanner: isVisible(byText('COM-сканер')),
      settingsGear: isVisible(gear),
      visibleTexts: buttons.filter(isVisible).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 12)
    });
  })()`));
  if (SHOT && label === 'mobile') {
    await evaluate(`(() => { const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Проверить коды'); if (el) el.scrollIntoView({ block: 'center' }); return 1; })()`);
    await sleep(600);
    await shot(SHOT);
  }
}

await inspect('mobile', 390, 844, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
await inspect('desktop', 1440, 1000, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

console.log('\nconsole errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));
ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
