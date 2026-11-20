import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT = process.argv[3] || '';
const PORT = 9651;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-botw-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', '--window-size=1440,1100', 'about:blank'
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
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
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
const waitFor = async (expression, timeoutMs = 25000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(400);
  }
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
await send('Page.navigate', { url: `${BASE}/app/labels` });
await waitFor(`!!document.querySelector('.ai-launcher')`);
await sleep(1200);

console.log('launcher robot:', await evaluate(`(() => {
  const b = document.querySelector('.ai-launcher');
  const rb = b?.querySelector('.rb-robot');
  return JSON.stringify({
    launcher: !!b,
    robotInButton: !!rb,
    state: rb ? rb.dataset.state : null,
    disc: !!b?.querySelector('.ai-bot-disc'),
    iris: b?.querySelectorAll('.rb-iris').length || 0
  });
})()`));
await shot(SHOT ? SHOT.replace('.png', '-launcher.png') : 'launcher.png');

console.log('open:', await evaluate(`(() => { document.querySelector('.ai-launcher')?.click(); return 1; })()`));
await waitFor(`!!document.querySelector('.ai-shell')`);
await sleep(700);
console.log('after open (wave):', await evaluate(`(() => {
  const rb = document.querySelector('.ai-shell .rb-robot');
  return JSON.stringify({ headerRobot: !!rb, state: rb ? rb.dataset.state : null });
})()`));

console.log('ask:', await evaluate(`(async () => {
  const area = document.querySelector('.ai-shell textarea');
  if (!area) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, 'Код не читается сканером, что проверить?');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const btn = [...document.querySelectorAll('.ai-shell button')].find((b) => b.textContent.trim() === 'Спросить');
  if (!btn || btn.disabled) return 'no-send';
  btn.click();
  return 'sent';
})()`));
await sleep(900);
console.log('while thinking:', await evaluate(`document.querySelector('.ai-shell .rb-robot')?.dataset.state`));
if (SHOT) await shot(SHOT.replace('.png', '-thinking.png'));

await sleep(26000);
console.log('after answer:', await evaluate(`(() => {
  const rb = document.querySelector('.ai-shell .rb-robot');
  const t = document.querySelector('.ai-shell')?.innerText || '';
  return JSON.stringify({ state: rb ? rb.dataset.state : null, answered: t.includes('проверьте') || t.includes('Проверьте') || t.length > 300 });
})()`));
if (SHOT) await shot(SHOT);

console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 3)));

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
