// CODE QR PRO — Windows Print Bridge
// Локальный HTTP-сервис: веб-приложение отправляет этикетки, Bridge печатает на принтер Windows.
// Запуск: node bridge.mjs (или start.bat). Слушает ТОЛЬКО 127.0.0.1:9101.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BRIDGE_PORT || 9101);
const TOKEN_FILE = join(__dirname, 'bridge-token.txt');
if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, randomBytes(16).toString('hex'));
const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
const ALLOWED = new Set(['https://code-qr.stockcity.ru', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const MAX_BODY = 30 * 1024 * 1024;

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function ps(args) {
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => resolve({ code, out, err }));
    p.on('error', e => resolve({ code: -1, out: '', err: String(e) }));
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/ping') return send(res, 200, { ok: true, service: 'code-qr-print-bridge', version: 1 });
    if (req.headers['x-bridge-token'] !== TOKEN) return send(res, 401, { error: 'Неверный токен Bridge' });

    if (url.pathname === '/printers' && req.method === 'GET') {
      const r = await ps(['-Command', '[Reflection.Assembly]::LoadWithPartialName(\'System.Drawing\') | Out-Null; [System.Drawing.Printing.PrinterSettings]::InstalledPrinters']);
      if (r.code !== 0) return send(res, 500, { error: 'Не удалось получить список принтеров', detail: r.err.slice(0, 300) });
      return send(res, 200, { printers: r.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean) });
    }

    if (url.pathname === '/print' && req.method === 'POST') {
      let body = '';
      for await (const c of req) { body += c; if (body.length > MAX_BODY) { res.writeHead(413); return res.end(); } }
      let job;
      try { job = JSON.parse(body); } catch { return send(res, 400, { error: 'Некорректный JSON' }); }
      if (!job.widthMm || !job.heightMm || !Array.isArray(job.elements)) return send(res, 400, { error: 'Нет размеров или элементов этикетки' });
      if (!job.savePng && !job.printer) return send(res, 400, { error: 'Не указан принтер' });
      const dir = mkdtempSync(join(tmpdir(), 'cqbridge-'));
      try {
        const jsonPath = join(dir, 'job.json');
        writeFileSync(jsonPath, JSON.stringify(job));
        const r = await ps(['-File', join(__dirname, 'print.ps1'), '-JsonPath', jsonPath]);
        if (r.code !== 0) return send(res, 500, { error: 'Ошибка печати', detail: (r.err || r.out).slice(0, 500) });
        const extra = {};
        const pngPath = join(dir, 'preview.png');
        if (job.savePng && existsSync(pngPath)) extra.pngBase64 = readFileSync(pngPath).toString('base64');
        return send(res, 200, { ok: true, ...extra });
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) { send(res, 500, { error: String(e?.message || e) }); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('==============================================');
  console.log(' CODE QR PRO — Print Bridge');
  console.log(' Адрес: http://127.0.0.1:' + PORT);
  console.log(' Токен (вставьте в настройках печати на сайте):');
  console.log(' ' + TOKEN);
  console.log('==============================================');
});
