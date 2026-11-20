import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://code-qr.stockcity.ru';
const HOST = 'code-qr.stockcity.ru';
const TOKEN = process.argv[2];
const SHOT_DIR = process.argv[3] || 'docs';
const PORT = 9711;
const CODE = '0104638230913287215Xk!ABCdef';

const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mobileprint-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'
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
const net = [];
let netOn = false;
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (!netOn) return;
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params.request.url;
    if (/\/api\/(labels|sets)\/(pdf|print)/.test(url)) net.push({ kind: 'req', method: msg.params.request.method, url, id: msg.params.requestId });
  }
  if (msg.method === 'Network.responseReceived') {
    const url = msg.params.response.url;
    if (/\/api\/(labels|sets)\/(pdf|print)/.test(url)) net.push({ kind: 'res', url, status: msg.params.response.status, mime: msg.params.response.mimeType, id: msg.params.requestId });
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
const waitFor = async (expression, timeoutMs = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(500);
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
await send('Network.enable');

async function runMode(mode, ua, width, height) {
  net.length = 0;
  netOn = true;
  consoleErrors.length = 0;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
  await send('Network.setUserAgentOverride', { userAgent: ua });
  await send('Network.setCookie', { name: 'cq_session', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  await send('Page.navigate', { url: `${BASE}/app/reprint` });
  await waitFor(`!!document.querySelector('textarea')`);
  await sleep(1200);

  console.log(`\n===== ${mode} =====`);
  console.log('buttons:', await evaluate(`(() => {
    const pdf = [...document.querySelectorAll('button')].find((b) => /^PDF\\s*\\(\\d+\\)/.test((b.textContent || '').trim()));
    const pr = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Печать');
    const size = (el) => el ? { text: (el.textContent || '').trim(), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), visible: el.offsetParent !== null, disabled: el.disabled } : null;
    return JSON.stringify({ pdf: size(pdf), print: size(pr), mobileHints: document.body.innerText.includes('AirPrint') || document.body.innerText.includes('Mopria') });
  })()`));

  // вставляем валидный код
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(CODE)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await sleep(900);
  console.log('after fill:', await evaluate(`(() => {
    const pdf = [...document.querySelectorAll('button')].find((b) => /^PDF\\s*\\(\\d+\\)/.test((b.textContent || '').trim()));
    const pr = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Печать');
    return JSON.stringify({ pdf: pdf ? { text: pdf.textContent.trim(), disabled: pdf.disabled } : null, print: pr ? { disabled: pr.disabled } : null });
  })()`));
  await evaluate(`(() => {
    const pdf = [...document.querySelectorAll('button')].find((b) => /^PDF\\s*\\(\\d+\\)/.test((b.textContent || '').trim()));
    if (pdf) pdf.scrollIntoView({ block: 'center' });
    return 1;
  })()`);
  await sleep(400);
  await shot(path.join(SHOT_DIR, mode === 'iOS' ? 'mobile-print-ios.png' : 'mobile-print-android.png'));

  // поток «Скачать PDF»
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^PDF\\s*\\(\\d+\\)/.test((b.textContent || '').trim()));
    if (btn && !btn.disabled) btn.click();
    return 1;
  })()`);
  await waitFor(`(() => {
    const t = document.body.innerText || '';
    return t.includes('PDF открылся') || t.includes('Не удалось') || t.includes('Ошибка') || t.includes('PDF готов');
  })()`, 45000).catch(() => {});
  await sleep(1800);
  const pdfReqs = net.map((n) => ({ ...n }));
  console.log('pdf flow:', await evaluate(`(() => {
    const t = document.body.innerText || '';
    const lines = t.split('\\n').map((s) => s.trim()).filter(Boolean);
    const info = lines.find((s) => /PDF (скачан|открылся|готов)|Не удалось|Ошибка|На телефоне/.test(s)) || null;
    return JSON.stringify({ message: info });
  })()`));
  console.log('pdf requests:', JSON.stringify(pdfReqs.filter((r) => r.kind === 'req' && /pdf/.test(r.url))));
  console.log('pdf responses:', JSON.stringify(pdfReqs.filter((r) => r.kind === 'res' && /pdf/.test(r.url))));
  if (mode === 'iOS') await shot(path.join(SHOT_DIR, 'mobile-print-ios.png'));

  // поток «Печать» (после PDF-потока reload: на iOS текущая вкладка могла уйти в PDF)
  await send('Page.navigate', { url: `${BASE}/app/reprint` });
  await waitFor(`!!document.querySelector('textarea')`);
  await sleep(1000);
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(CODE)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await sleep(800);
  net.length = 0;
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Печать');
    if (btn && !btn.disabled) btn.click();
    return 1;
  })()`);
  await waitFor(`(() => {
    const t = document.body.innerText || '';
    return t.includes('Окно печати') || t.includes('PDF открылся') || t.includes('Не удалось') || t.includes('Ошибка');
  })()`, 40000).catch(() => {});
  await sleep(1500);
  const printReq = net.find((n) => n.kind === 'res' && /\/print/.test(n.url));
  const printPdfReq = net.find((n) => n.kind === 'res' && /pdf\/file|pdf\/ticket/.test(n.url));
  let printHtml = '';
  for (const n of net) {
    if (n.kind === 'res' && /\/print/.test(n.url)) {
      try {
        const body = await send('Network.getResponseBody', { requestId: n.id });
        printHtml = body.result?.body || '';
      } catch { /* ignore */ }
    }
  }
  console.log('print flow:', await evaluate(`(() => {
    const t = document.body.innerText || '';
    const first = t.split('\\n').map((s) => s.trim()).filter(Boolean).find((s) => /Окно печати|PDF открылся|Не удалось|Ошибка/.test(s)) || null;
    return JSON.stringify({ message: first });
  })()`));
  console.log('print network:', JSON.stringify({
    print: printReq ? { status: printReq.status, mime: printReq.mime } : null,
    pdf: printPdfReq ? { status: printPdfReq.status, url: printPdfReq.url.replace(BASE, '') } : null
  }));
  if (printHtml) {
    console.log('print html checks:', JSON.stringify({
      hasPrintButton: /data-print/.test(printHtml) && /print-tools\.js/.test(printHtml),
      hasAirPrint: /AirPrint/.test(printHtml),
      hasMopria: /Mopria/.test(printHtml),
      pageSize: (printHtml.match(/@page\s*\{[^}]*\}/) || [])[0] || null,
      barHiddenOnPrint: /@media print\s*\{\s*\.bar/.test(printHtml),
      length: printHtml.length
    }));
  } else {
    console.log('print html checks: нет HTML (на iOS печать идёт через PDF)');
  }
  console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 2)));

  // Проверка лимитов на телефоне: 1600 кодов → подсказка вместо генерации
  await send('Page.navigate', { url: `${BASE}/app/reprint` });
  await waitFor(`!!document.querySelector('textarea')`);
  await sleep(900);
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, Array(1600).fill(${JSON.stringify(CODE)}).join('\\n'));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await sleep(900);
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^PDF\\s*\\(\\d+\\)/.test((b.textContent || '').trim()));
    if (btn && !btn.disabled) btn.click();
    return 1;
  })()`);
  await sleep(1500);
  console.log('limit guard (PDF 1600):', await evaluate(`(() => {
    const t = document.body.innerText || '';
    const m = t.match(/На телефоне[^\\n]*/);
    return JSON.stringify({ shown: Boolean(m), text: m ? m[0].slice(0, 120) : null });
  })()`));

  if (mode === 'Android') {
    await evaluate(`(() => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, Array(300).fill(${JSON.stringify(CODE)}).join('\\n'));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(900);
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Печать');
      if (btn && !btn.disabled) btn.click();
      return 1;
    })()`);
    await sleep(1500);
    console.log('limit guard (print 300):', await evaluate(`(() => {
      const t = document.body.innerText || '';
      const m = t.match(/Печать из браузера на телефоне[^\\n]*/);
      return JSON.stringify({ shown: Boolean(m), text: m ? m[0].slice(0, 120) : null });
    })()`));
  }

  await sleep(500);
  netOn = false;
}

await runMode('iOS', UA_IOS, 390, 844);
await runMode('Android', UA_ANDROID, 412, 915);

ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
