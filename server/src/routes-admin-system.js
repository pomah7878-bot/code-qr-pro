import os from 'node:os';
import { existsSync, readdirSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { smtpConfigured } from './lib/mailer.js';
import { providerConfigured } from './billing.js';
import { tgConfigured } from './lib/telegram-api.js';
import { npdSettings } from './lib/npd-receipt.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';

const APP_DIR = '/opt/code-qr';
const DB_DIR = join(APP_DIR, 'server', 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || '/opt/backups/code-qr';
const backupLog = '/var/log/code-qr-backup.log';

function fileSize(path) {
  try { return statSync(path).size; } catch { return 0; }
}

function dbFile(name) {
  return join(DB_DIR, name);
}

function diskInfo() {
  try {
    const s = statfsSync('/');
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bfree) * Number(s.bsize);
    return { total, free, used: total - free, percent: total ? Math.round(((total - free) / total) * 100) : 0 };
  } catch { return null; }
}

function backups() {
  try {
    if (!existsSync(BACKUP_DIR)) return { dir: BACKUP_DIR, latest: null, items: [], ok: false };
    const items = readdirSync(BACKUP_DIR)
      .filter((n) => /^app-.*\.db\.enc$/.test(n))
      .map((name) => {
        const p = join(BACKUP_DIR, name);
        try { const st = statSync(p); return { name, size: st.size, at: st.mtime.toISOString() }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 10);
    const latest = items[0] || null;
    const ageHours = latest ? Math.max(0, Math.round((Date.now() - new Date(latest.at).getTime()) / 3600000)) : null;
    return { dir: BACKUP_DIR, latest, items, ageHours, ok: Boolean(latest && ageHours <= 36) };
  } catch (e) {
    return { dir: BACKUP_DIR, latest: null, items: [], ok: false, error: String(e?.message || e) };
  }
}

function latestBackupLog() {
  try {
    const lines = readFileSync(backupLog, 'utf8').trim().split(/\r?\n/);
    return lines.slice(-3).join('\n');
  } catch { return ''; }
}

function integrationState() {
  let czConfigured = false;
  try { czConfigured = Boolean(getSetting('cz_enabled', '0') === '1' && getSetting('cz_token', '')); } catch { /* ignore */ }
  const npd = npdSettings();
  return {
    sqlite: true,
    smtp: smtpConfigured(),
    yookassa: providerConfigured(),
    telegram: tgConfigured(),
    cz: czConfigured,
    npd: Boolean(npd.enabled && npd.configured),
    npdEnabled: Boolean(npd.enabled)
  };
}

function counts() {
  const one = (sql) => { try { return Number(db.prepare(sql).get()?.c || 0); } catch { return 0; } };
  return {
    users: one('SELECT COUNT(*) c FROM users'),
    paidUsers: one("SELECT COUNT(*) c FROM users WHERE plan IN ('start','pro','business','enterprise')"),
    ordersPending: one("SELECT COUNT(*) c FROM orders WHERE status='pending'"),
    ordersPaid: one("SELECT COUNT(*) c FROM orders WHERE status='paid'"),
    jobsQueued: one("SELECT COUNT(*) c FROM generation_jobs WHERE status='queued'"),
    jobsRunning: one("SELECT COUNT(*) c FROM generation_jobs WHERE status='running'"),
    jobsError: one("SELECT COUNT(*) c FROM generation_jobs WHERE status='error'"),
    supportOpen: one("SELECT COUNT(*) c FROM support_tickets WHERE status='open'"),
    reviewsPending: one("SELECT COUNT(*) c FROM reviews WHERE status='pending'"),
    bankUnmatched: one("SELECT COUNT(*) c FROM bank_transactions WHERE status IN ('unmatched','error')"),
    npdErrors: one("SELECT COUNT(*) c FROM orders WHERE npd_receipt_status='error'")
  };
}

function externalStats() {
  try {
    const row = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) failed,
      COALESCE(SUM(cost_units),0) cost
      FROM external_requests WHERE created_at > datetime('now','-1 day')`).get() || {};
    const adapters = db.prepare(`SELECT adapter, COUNT(*) total,
      SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) failed
      FROM external_requests WHERE created_at > datetime('now','-1 day')
      GROUP BY adapter ORDER BY total DESC LIMIT 10`).all();
    return { total: Number(row.total) || 0, failed: Number(row.failed) || 0, costUnits: Number(row.cost) || 0, adapters };
  } catch { return { total: 0, failed: 0, costUnits: 0, adapters: [] }; }
}

function recentErrors() {
  try {
    return db.prepare(`SELECT id,level,source,event,message,created_at FROM app_logs
      WHERE level IN ('error','warn') ORDER BY id DESC LIMIT 12`).all();
  } catch { return []; }
}

function alerts(status) {
  const out = [];
  if (!status.backups.ok) out.push({ level: 'warn', text: 'Нет свежего бэкапа БД (старше 36 часов)', to: '/app/admin/system' });
  if (status.integrations.npdEnabled && !status.integrations.npd) out.push({ level: 'warn', text: 'Чеки НПД включены, но интеграция не настроена', to: '/app/admin/settings' });
  if (!status.integrations.yookassa) out.push({ level: 'red', text: 'ЮKassa не настроена', to: '/app/admin/settings' });
  if (!status.integrations.smtp) out.push({ level: 'warn', text: 'SMTP не настроен — письма клиентам не уходят', to: '/app/admin/settings' });
  if (status.disk && status.disk.percent >= 85) out.push({ level: 'red', text: `Мало места на диске: ${status.disk.percent}%`, to: '/app/admin/system' });
  if (status.counts.jobsError > 0) out.push({ level: 'warn', text: `${status.counts.jobsError} заданий с ошибкой`, to: '/app/admin/jobs' });
  if (status.counts.ordersPending > 0) out.push({ level: 'warn', text: `${status.counts.ordersPending} заказов ожидают оплаты`, to: '/app/admin/orders' });
  if (status.counts.supportOpen > 0) out.push({ level: 'warn', text: `${status.counts.supportOpen} открытых обращений`, to: '/app/admin/support' });
  return out;
}

export async function registerAdminSystemRoutes(app) {
  app.get('/api/admin/system/status', { preHandler: requireAdmin }, async () => {
    const mem = process.memoryUsage();
    const dbSize = fileSize(dbFile('app.db'));
    const walSize = fileSize(dbFile('app.db-wal'));
    const disk = diskInfo();
    const b = backups();
    const status = {
      now: new Date().toISOString(),
      process: {
        pid: process.pid,
        node: process.version,
        uptime: Math.round(process.uptime()),
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        load: os.loadavg(),
        cpus: os.cpus().length,
        totalMem: os.totalmem(),
        freeMem: os.freemem()
      },
      db: { size: dbSize, wal: walSize, userVersion: Number(db.pragma('user_version', { simple: true })) || 0 },
      disk,
      counts: counts(),
      integrations: integrationState(),
      external: externalStats(),
      errors: recentErrors(),
      backups: { ...b, log: latestBackupLog() },
      maintenance: getSetting('maintenance_mode', '0') === '1'
    };
    status.alerts = alerts(status);
    return status;
  });

  app.put('/api/admin/system/maintenance', { preHandler: requireAdmin }, async (req, reply) => {
    const enabled = Boolean(req.body?.enabled);
    setSetting('maintenance_mode', enabled ? '1' : '0');
    audit(req, 'system.maintenance', 'settings', 'maintenance', { enabled });
    return { ok: true, enabled };
  });
}
