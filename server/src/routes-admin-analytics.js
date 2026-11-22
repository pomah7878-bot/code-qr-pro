import { statSync, readdirSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { db, today } from './db.js';
import { JOBS_DIR, enqueue, removeJobFiles } from './jobs.js';
import { providerConfigured } from './billing.js';
import { notifyConfigured } from './notify.js';
import { czStatus } from './cz.js';
import { requireAdmin, requireStaff, paging, like } from './lib/admin.js';
import { audit } from './lib/audit.js';

const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

let jobsSizeCache = { at: 0, size: 0 };
function dirSize(dir) {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      total += entry.isDirectory() ? dirSize(p) : statSync(p).size;
    }
  } catch { /* каталога может не быть */ }
  return total;
}
function jobsDirSize() {
  const now = Date.now();
  if (now - jobsSizeCache.at > 60000) {
    jobsSizeCache = { at: now, size: dirSize(JOBS_DIR) };
  }
  return jobsSizeCache.size;
}
function dbSize() {
  try {
    const pageCount = db.pragma('page_count', { simple: true });
    const pageSize = db.pragma('page_size', { simple: true });
    return pageCount * pageSize;
  } catch { return 0; }
}
function disk() {
  try {
    const s = statfsSync(process.cwd());
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { return null; }
}

const sum = (sql, ...params) => db.prepare(sql).get(...params)?.v || 0;

export async function registerAdminAnalyticsRoutes(app) {
  // Сводка с дельтой к прошлому периоду
  app.get('/api/admin/overview', { preHandler: requireAdmin }, async (req) => {
    const days = Math.min(365, Math.max(7, int(req.query?.days, 30)));
    const rev = (from) => sum(
      `SELECT COALESCE(SUM(amount),0) v FROM orders
       WHERE status='paid' AND date(paid_at) >= date('now', ?)`, from
    );
    const revenueToday = sum(
      "SELECT COALESCE(SUM(amount),0) v FROM orders WHERE status='paid' AND date(paid_at)=date('now')"
    );
    const revenue7 = rev('-6 days');
    const revenue30 = rev('-29 days');
    const revenuePrev = sum(
      `SELECT COALESCE(SUM(amount),0) v FROM orders
       WHERE status='paid' AND date(paid_at) >= date('now','-59 days') AND date(paid_at) < date('now','-29 days')`
    );
    const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const newUsers30 = db.prepare("SELECT COUNT(*) c FROM users WHERE date(created_at) >= date('now','-29 days')").get().c;
    const newUsersPrev = db.prepare("SELECT COUNT(*) c FROM users WHERE date(created_at) >= date('now','-59 days') AND date(created_at) < date('now','-29 days')").get().c;
    const premium = db.prepare("SELECT COUNT(*) c FROM users WHERE plan IN ('start','pro','business','enterprise')").get().c;
    const blocked = db.prepare("SELECT COUNT(*) c FROM users WHERE status='blocked'").get().c;
    const paidUsers = db.prepare("SELECT COUNT(DISTINCT user_id) c FROM orders WHERE status='paid'").get().c;
    const paidOrders30 = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='paid' AND date(paid_at) >= date('now','-29 days')").get().c;
    const activeSubs = db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status='active' AND expires_at > datetime('now')").get().c;
    const expiring7 = db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status='active' AND expires_at > datetime('now') AND expires_at <= datetime('now','+7 days')").get().c;
    const pendingOrders = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM orders WHERE status='pending'").get();
    const queued = db.prepare("SELECT COUNT(*) c FROM generation_jobs WHERE status IN ('queued','running')").get().c;
    const jobErrors = db.prepare("SELECT COUNT(*) c FROM generation_jobs WHERE status='error' AND created_at >= datetime('now','-1 day')").get().c;

    const monthlyPrice = db.prepare("SELECT COALESCE(SUM(p.price_monthly),0) c FROM subscriptions s JOIN plans p ON p.id=s.plan WHERE s.status='active' AND s.expires_at > datetime('now')").get().c;
    return {
      days,
      revenue: { today: revenueToday, week: revenue7, month: revenue30, prevMonth: revenuePrev },
      users: { total: users, new30: newUsers30, newPrev: newUsersPrev, premium, blocked, paid: paidUsers },
      subscriptions: { active: activeSubs, expiring7 },
      orders: { pending: pendingOrders.c, pendingSum: pendingOrders.s, paid30: paidOrders30 },
      jobs: { queue: queued, errors24h: jobErrors },
      money: {
        mrr: Math.round(monthlyPrice),
        arpu: paidUsers ? Math.round(revenue30 / paidUsers) : 0,
        avgCheck: paidOrders30 ? Math.round(revenue30 / paidOrders30) : 0,
        conversion: users ? Math.round((paidUsers / users) * 1000) / 10 : 0
      }
    };
  });

  // Ряды для графика: выручка, регистрации, коды
  app.get('/api/admin/series', { preHandler: requireAdmin }, async (req) => {
    const days = Math.min(365, Math.max(7, int(req.query?.days, 30)));
    const from = `-${days - 1} days`;
    const revenue = db.prepare(
      `SELECT date(paid_at) d, COALESCE(SUM(amount),0) v FROM orders
       WHERE status='paid' AND date(paid_at) >= date('now', ?) GROUP BY d`
    ).all(from);
    const signups = db.prepare(
      `SELECT date(created_at) d, COUNT(*) v FROM users
       WHERE date(created_at) >= date('now', ?) GROUP BY d`
    ).all(from);
    const codes = db.prepare(
      `SELECT day d, COALESCE(SUM(codes_generated),0) v FROM usage_daily
       WHERE day >= date('now', ?) GROUP BY d`
    ).all(from);

    const map = (rows) => new Map(rows.map((r) => [r.d, r.v]));
    const rev = map(revenue);
    const reg = map(signups);
    const cds = map(codes);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      out.push({ date: d, revenue: rev.get(d) || 0, signups: reg.get(d) || 0, codes: cds.get(d) || 0 });
    }
    return { days, points: out };
  });

  // Здоровье сервиса
  app.get('/api/admin/health', { preHandler: requireAdmin }, async () => {
    const d = disk();
    const jobStats = db.prepare("SELECT status, COUNT(*) c FROM generation_jobs GROUP BY status").all();
    const jobs = Object.fromEntries(jobStats.map((r) => [r.status, r.c]));
    return {
      uptime: Math.round(process.uptime()),
      rss: process.memoryUsage().rss,
      node: process.version,
      dbSize: dbSize(),
      jobsSize: jobsDirSize(),
      disk: d,
      jobs,
      integrations: {
        yookassa: providerConfigured(),
        telegram: notifyConfigured(),
        cz: czStatus().configured,
        smtp: Boolean(db.prepare("SELECT value FROM app_settings WHERE key='smtp_host'").get()?.value)
      },
      generatedAt: new Date().toISOString()
    };
  });

  // Все задания сервиса
  app.get('/api/admin/jobs', { preHandler: requireStaff }, async (req) => {
    const { page, per, offset } = paging(req.query);
    const where = [];
    const params = [];
    const status = String(req.query?.status || '');
    if (['queued', 'running', 'done', 'error'].includes(status)) {
      where.push('j.status = ?');
      params.push(status);
    }
    const q = String(req.query?.q || '').trim().slice(0, 120);
    if (q) {
      const l = like(q);
      where.push("(u.email LIKE ? ESCAPE '\\' OR j.name LIKE ? ESCAPE '\\')");
      params.push(l, l);
      if (/^\d{1,10}$/.test(q)) {
        where.push('j.id = ?');
        params.push(Number(q));
      }
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const jobs = db.prepare(`
      SELECT j.id, j.name, j.mode, j.format, j.status, j.total, j.valid, j.done, j.error,
             j.created_at, j.finished_at, u.email
      FROM generation_jobs j JOIN users u ON u.id=j.user_id
      ${whereSql} ORDER BY j.id DESC LIMIT ? OFFSET ?
    `).all(...params, per, offset);
    const total = db.prepare(
      `SELECT COUNT(*) c FROM generation_jobs j JOIN users u ON u.id=j.user_id ${whereSql}`
    ).get(...params).c;
    return { jobs, total, page, per, pages: Math.max(1, Math.ceil(total / per)) };
  });

  app.get('/api/admin/jobs/:id', { preHandler: requireStaff }, async (req, reply) => {
    const job = db.prepare(`
      SELECT j.*, u.email FROM generation_jobs j JOIN users u ON u.id=j.user_id WHERE j.id=?
    `).get(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено' });
    const items = db.prepare(
      'SELECT row_index, raw, gtin, serial, status, error FROM job_items WHERE job_id=? ORDER BY row_index LIMIT 500'
    ).all(job.id);
    return { job, items };
  });

  // Повторный запуск: файлы и прогресс сбрасываются
  app.post('/api/admin/jobs/:id/retry', { preHandler: requireAdmin }, async (req, reply) => {
    const job = db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено' });
    if (!['done', 'error'].includes(job.status)) {
      return reply.code(400).send({ error: 'Перезапустить можно только завершённое или упавшее задание' });
    }
    try { await removeJobFiles(job.id); } catch { /* файлов могло не быть */ }
    db.transaction(() => {
      db.prepare("UPDATE job_items SET status='ok', error=NULL WHERE job_id=? AND status='generated'").run(job.id);
      db.prepare("UPDATE generation_jobs SET status='queued', done=0, error=NULL, finished_at=NULL, artifact_key=NULL, artifact_size=0, artifact_sha=NULL, archived_at=NULL, expires_at=NULL WHERE id=?").run(job.id);
    })();
    enqueue(job.id);
    audit(req, 'job.retry', 'job', job.id, {});
    return { ok: true, job: db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(job.id) };
  });

  app.delete('/api/admin/jobs/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const job = db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено' });
    try { await removeJobFiles(job.id); } catch { /* файлов могло не быть */ }
    db.prepare('DELETE FROM generation_jobs WHERE id=?').run(job.id);
    audit(req, 'job.delete', 'job', job.id, { user_id: job.user_id, total: job.total });
    return { ok: true };
  });
}

