#!/usr/bin/env node
/**
 * Импорт истории из access-логов nginx в первичную аналитику.
 * Запускать на сервере из каталога /opt/code-qr/server:
 *   node scripts/analytics-import-nginx.mjs --days=30 --logs=/var/log/nginx
 * Люди и боты за сегодня не импортируются — их пишет живой трекер/хук.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

// Запускать из каталога server/, чтобы разрешился better-sqlite3 и модуль аналитики.
const { detectBot, detectDevice, parseReferrer, normalizePath, isTrackablePage } = await import(
  pathToFileURL(path.join(process.cwd(), 'src/lib/analytics.js')).href
);

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const DAYS = Math.max(1, Math.min(365, Number(args.days) || 30));
const LOG_DIR = String(args.logs || '/var/log/nginx');
const DB_PATH = process.env.ANALYTICS_DB || '/opt/code-qr/server/data/app.db';
const TODAY = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);

const db = new Database(DB_PATH);
const insertVisit = db.prepare(
  `INSERT OR IGNORE INTO site_visits (created_at, day, path, referrer, source, medium, campaign, query, device, session_id, visitor_id, origin)
   VALUES (?,?,?,?,?,?,?,?,?,?,?, 'import')`
);
const insertBot = db.prepare(
  `INSERT INTO site_visits (created_at, day, path, source, medium, engine, is_bot, status, origin)
   VALUES (?,?,'/','seo','bot',?,1,?,'import')`
);
const insertBotPath = db.prepare(
  `INSERT INTO site_visits (created_at, day, path, source, medium, engine, is_bot, status, origin)
   VALUES (?,?,?,'seo','bot',?,1,?,'import')`
);

function hash(v) {
  return createHash('sha1').update(String(v)).digest('hex').slice(0, 20);
}

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
function parseDay(stamp) {
  const m = /^(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/.exec(String(stamp || ''));
  if (!m) return null;
  return `${m[3]}-${MONTHS[m[2]] || '01'}-${m[1]}`;
}

const RE = /^(\S+) - \S+ \[([^\]]+)\] "(\S+) ([^"]*?) HTTP\/[^"]*" (\d{3}) \S+ "([^"]*)" "([^"]*)"/;

let files = [];
try {
  files = fs.readdirSync(LOG_DIR)
    .filter((f) => /^access\.log(\.\d+)?(\.gz)?$/.test(f))
    .map((f) => path.join(LOG_DIR, f));
} catch (e) {
  console.error('Не читается каталог логов:', e.message);
  process.exit(1);
}

function open(file) {
  const stream = fs.createReadStream(file);
  if (file.endsWith('.gz')) return stream.pipe(zlib.createGunzip());
  return stream;
}

let human = 0; let bot = 0; let skipped = 0;
const importedDays = new Set();

// Сначала убираем прошлый импорт в диапазоне, чтобы не задваивать
const del = db.prepare("DELETE FROM site_visits WHERE origin='import' AND day >= ? AND day < ?");
del.run(since, TODAY);

for (const file of files) {
  let rl;
  try { rl = readline.createInterface({ input: open(file), crlfDelay: Infinity }); } catch { continue; }
  for await (const line of rl) {
    const m = RE.exec(line);
    if (!m) { skipped += 1; continue; }
    const [, ip, stamp, method, url, statusRaw, referrer, ua] = m;
    if (method !== 'GET') continue;
    const status = Number(statusRaw) || 0;
    const day = parseDay(stamp);
    if (!day || day < since || day >= TODAY) continue;
    const pathOnly = normalizePath(url);
    if (!isTrackablePage(pathOnly)) continue;
    const engine = detectBot(ua);
    const created = day + ' ' + (stamp.split(':').slice(1, 3).join(':') + ':00');
    if (engine) {
      if (status >= 400) continue;
      insertBotPath.run(created, day, pathOnly, engine, status);
      importedDays.add(day);
      bot += 1;
      continue;
    }
    if (status < 200 || status >= 400) continue;
    const ref = parseReferrer(referrer, 'code-qr.stockcity.ru');
    const device = detectDevice(ua);
    const session = hash(ip + ua + day);
    const visitor = hash(ip + ua);
    const info = insertVisit.run(
      created, day, pathOnly, ref.referrer.slice(0, 500), ref.source, ref.medium, '', ref.query,
      device, session, visitor
    );
    if (info.changes) { human += 1; importedDays.add(day); }
  }
}

console.log(JSON.stringify({
  ok: true,
  days: DAYS,
  from: since,
  to: TODAY,
  humanPageviews: human,
  botHits: bot,
  daysWithData: [...importedDays].sort(),
  skippedLines: skipped,
  files: files.length
}, null, 1));
db.close();
