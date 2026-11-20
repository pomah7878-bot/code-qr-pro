import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const PORT = 9721;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-diag-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) { target = await r.json(); break; } } catch { /* wait */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res) => { ws.onopen = res; });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');

const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

async function diag(name, ua) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Network.setUserAgentOverride', { userAgent: ua });
  await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  await send('Page.navigate', { url: `${BASE}/app/reprint` });
  await sleep(2500);
  console.log(`\n===== ${name} =====`);
  console.log('buttons:', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].map((b) => ({
    text: (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
    disabled: b.disabled,
    visible: b.offsetParent !== null && b.getBoundingClientRect().height > 0
  })).filter((b) => b.text).slice(0, 30))`));
  console.log('textareas:', await evaluate(`JSON.stringify([...document.querySelectorAll('textarea')].map((t, i) => ({
    i, placeholder: (t.placeholder || '').slice(0, 40), visible: t.offsetParent !== null
  })))`));
  console.log('iosFlag:', await evaluate(`/iPad|iPhone|iPod/.test(navigator.userAgent)`));
  console.log('premiumVisible:', await evaluate(`(document.body.innerText || '').includes('PDF-печать доступна')`));
}

await diag('iOS', UA_IOS);
await diag('Android', UA_ANDROID);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
