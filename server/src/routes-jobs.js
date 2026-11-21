import { db, today, usageToday } from './db.js';
import { consumeOperations, UsageError } from './lib/usage.js';
import { planOf } from './plans.js';
import { requireAuth } from './routes.js';
import { validateRow } from './gs1.js';
import { enqueue, renderSVG, renderPNG, removeJobFiles, archiveJob, JOBS_DIR } from './jobs.js';
import { artifactExists, artifactStats, openArtifact } from './lib/artifacts.js';
import { presignArtifact } from './lib/s3.js';
import archiver from 'archiver';
import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRowIndex } from './security.js';

const MODES = ['cz', 'gs1', 'text'];

function validateBatch(rows, mode, plan) {
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'Нет данных' };
  if (rows.length > plan.batchMax) return { error: `Пакет больше лимита: максимум ${plan.batchMax} строк на вашем тарифе` };
  const items = rows.map((r, i) => {
    const raw = typeof r === 'string' ? r : (r?.data ?? '');
    return { row: i, raw: String(raw).slice(0, 2000), ...validateRow(raw, mode) };
  });
  return { items };
}

export function createJobForUser(user, body, opts = {}) {
  const { name, mode = 'cz', format = 'png', rows = [] } = body || {};
  if (!MODES.includes(mode)) return { status: 400, error: 'Неизвестный режим' };
  if (!['png', 'svg'].includes(format)) return { status: 400, error: 'Формат генерации: png или svg' };
  const plan = planOf(user);
  const { error, items } = validateBatch(rows, mode, plan);
  if (error) return { status: 400, error };
  const valid = items.filter(x => x.ok).length;
  if (valid === 0) return { status: 400, error: 'Нет валидных кодов — исправьте данные' };
  const idemKey = String(opts.idemKey || body?.idemKey || '').slice(0, 100);
  if (idemKey) {
    const existing = db.prepare('SELECT * FROM generation_jobs WHERE user_id=? AND idem_key=?').get(user.id, idemKey);
    if (existing) return { status: 200, job: existing, duplicated: true };
  }
  let jobId;
  try {
    jobId = db.transaction(() => {
      const info = db.prepare('INSERT INTO generation_jobs (user_id, name, mode, format, status, total, valid, idem_key) VALUES (?,?,?,?,?,?,?,?)')
        .run(user.id, String(name || 'Без названия').slice(0, 120), mode, format, 'queued', items.length, valid, idemKey || null);
      const id = info.lastInsertRowid;
      const ins = db.prepare('INSERT INTO job_items (job_id, row_index, raw, normalized, gtin, serial, status, error) VALUES (?,?,?,?,?,?,?,?)');
      for (const it of items) {
        ins.run(id, it.row, it.raw, it.normalized || null, it.gtin || null, it.serial || null, it.ok ? 'ok' : 'invalid', it.error || null);
      }
      // Лимиты: одна операция = один обработанный код; idemKey защищает от двойного списания.
      consumeOperations(user, valid, { idemKey: idemKey ? `${idemKey}:generation` : '', context: 'generation' });
      db.prepare(`INSERT INTO usage_daily (user_id, day, codes_generated) VALUES (?,?,?)
        ON CONFLICT(user_id, day) DO UPDATE SET codes_generated = codes_generated + excluded.codes_generated`)
        .run(user.id, today(), valid);
      return id;
    })();
  } catch (e) {
    if (e instanceof UsageError) return { status: e.statusCode || 402, error: e.message, quota: e.payload };
    throw e;
  }
  enqueue(jobId);
  return { status: 200, job: db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(jobId) };
}

export async function registerJobRoutes(app) {
  app.post('/api/jobs/validate', { preHandler: requireAuth }, async (req, reply) => {
    const { mode = 'cz', rows = [] } = req.body || {};
    if (!MODES.includes(mode)) return reply.code(400).send({ error: 'Неизвестный режим' });
    const plan = planOf(req.user);
    const { error, items } = validateBatch(rows, mode, plan);
    if (error) return reply.code(400).send({ error });
    return { total: items.length, valid: items.filter(x => x.ok).length, items };
  });

  app.post('/api/jobs', { preHandler: requireAuth }, async (req, reply) => {
    const r = createJobForUser(req.user, req.body, { idemKey: req.headers['x-idempotency-key'] });
    if (r.error) return reply.code(r.status).send({ error: r.error, quota: r.quota || null });
    return { job: r.job };
  });

  app.get('/api/jobs', { preHandler: requireAuth }, async (req) => ({
    jobs: db.prepare('SELECT id,name,mode,format,status,total,valid,done,artifact_size,created_at,finished_at,expires_at FROM generation_jobs WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id)
  }));

  const ownJob = (req, reply) => {
    const job = db.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!job) { reply.code(404).send({ error: 'Задание не найдено' }); return null; }
    return job;
  };

  app.get('/api/jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const job = ownJob(req, reply);
    if (!job) return;
    const items = db.prepare('SELECT row_index,raw,gtin,serial,status,error FROM job_items WHERE job_id=? ORDER BY row_index').all(job.id);
    return { job, items };
  });

  app.post('/api/jobs/:id/retry', { preHandler: requireAuth }, async (req, reply) => {
    const job = ownJob(req, reply);
    if (!job) return;
    if (!['done', 'error'].includes(job.status)) return reply.code(400).send({ error: 'Перезапустить можно только завершённое или упавшее задание' });
    try { await removeJobFiles(job.id); } catch { /* файлов могло не быть */ }
    db.transaction(() => {
      db.prepare("UPDATE job_items SET status='ok', error=NULL WHERE job_id=? AND status='generated'").run(job.id);
      db.prepare("UPDATE generation_jobs SET status='queued', done=0, error=NULL, finished_at=NULL, artifact_key=NULL, artifact_size=0, artifact_sha=NULL, archived_at=NULL, expires_at=NULL WHERE id=?").run(job.id);
    })();
    enqueue(job.id);
    return { job: db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(job.id) };
  });

  app.get('/api/jobs/:id/item/:row.png', { preHandler: requireAuth }, async (req, reply) => {
    if (!isRowIndex(req.params.row)) return reply.code(400).send({ error: 'Некорректный номер строки' });
    const job = ownJob(req, reply);
    if (!job) return;
    const p = join(JOBS_DIR, String(job.id), req.params.row + '.png');
    if (existsSync(p)) return reply.type('image/png').send(readFileSync(p));
    const item = db.prepare("SELECT * FROM job_items WHERE job_id=? AND row_index=? AND status='generated'").get(job.id, Number(req.params.row));
    if (!item) return reply.code(404).send({ error: 'Файл не найден' });
    return reply.type('image/png').send(await renderPNG(item, job.mode));
  });

  app.get('/api/jobs/:id/item/:row.svg', { preHandler: requireAuth }, async (req, reply) => {
    if (!isRowIndex(req.params.row)) return reply.code(400).send({ error: 'Некорректный номер строки' });
    const job = ownJob(req, reply);
    if (!job) return;
    const item = db.prepare('SELECT * FROM job_items WHERE job_id=? AND row_index=?').get(job.id, req.params.row);
    if (!item || !item.normalized) return reply.code(404).send({ error: 'Код не найден' });
    return reply.type('image/svg+xml').send(await renderSVG(item, job.mode));
  });

  app.get('/api/jobs/:id/export', { preHandler: requireAuth }, async (req, reply) => {
    const job = ownJob(req, reply);
    if (!job) return;
    const format = req.query.format || 'zip';
    const plan = planOf(req.user);
    if (!['zip', 'pdf'].includes(format)) return reply.code(400).send({ error: 'Формат экспорта: zip или pdf' });
    if (!plan.formats.includes(format)) return reply.code(403).send({ error: `Экспорт ${format.toUpperCase()} недоступен на вашем тарифе`, feature: 'formats' });
    if (job.status !== 'done') return reply.code(409).send({ error: 'Генерация ещё не завершена' });
    const items = db.prepare("SELECT * FROM job_items WHERE job_id=? AND status='generated' ORDER BY row_index").all(job.id);
    const fname = `code-qr-job-${job.id}.${format}`;

    if (format === 'zip') {
      if (job.artifact_key && job.artifact_backend === 's3') {
        return reply.redirect(await presignArtifact(job.artifact_key, fname));
      }
      if (job.artifact_key && artifactExists(job.artifact_key)) {
        const st = artifactStats(job.artifact_key);
        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', `attachment; filename="${fname}"`);
        if (st) reply.header('Content-Length', String(st.size));
        return reply.send(openArtifact(job.artifact_key));
      }
      const built = await archiveJob(job.id);
      if (built?.backend === 's3') return reply.redirect(await presignArtifact(built.key, fname));
      if (built && artifactExists(built.key)) {
        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', `attachment; filename="${fname}"`);
        reply.header('Content-Length', String(built.size));
        return reply.send(openArtifact(built.key));
      }
      reply.hijack();
      reply.raw.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fname}"` });
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(reply.raw);
      for (const it of items) {
        if (job.format === 'svg') archive.append(await renderSVG(it, job.mode), { name: `${it.row_index}.svg` });
        else {
          const p = join(JOBS_DIR, String(job.id), it.row_index + '.png');
          if (existsSync(p)) archive.file(p, { name: `${it.row_index}.png` });
          else archive.append(await renderPNG(it, job.mode), { name: `${it.row_index}.png` });
        }
      }
      await archive.finalize();
      return reply;
    }

    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}"` });
    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    doc.pipe(reply.raw);
    const cols = 4, cellW = (595.28 - 60) / cols, imgSize = cellW - 16;
    let x = 30, y = 30, col = 0;
    for (const it of items) {
      const p = join(JOBS_DIR, String(job.id), it.row_index + '.png');
      const image = existsSync(p) ? p : await renderPNG(it, job.mode);
      doc.image(image, x, y, { width: imgSize, height: imgSize });
      doc.fontSize(7).fillColor('#333333')
        .text(`${it.row_index + 1}. ${it.gtin || ''} ${it.serial || ''}`.trim(), x, y + imgSize + 2, { width: imgSize });
      col++;
      if (col >= cols) {
        col = 0; x = 30; y += imgSize + 24;
        if (y + imgSize + 24 > 841.89 - 30) { doc.addPage(); y = 30; }
      } else x += cellW;
    }
    doc.end();
    return reply;
  });

  app.get('/api/jobs/:id/archive', { preHandler: requireAuth }, async (req, reply) => {
    const job = ownJob(req, reply);
    if (!job) return;
    const plan = planOf(req.user);
    if (!plan.formats.includes('zip')) return reply.code(403).send({ error: 'Скачивание архива доступно на тарифе PREMIUM' });
    let key = job.artifact_key;
    let backend = job.artifact_backend || 'local';
    if (!key || (backend !== 's3' && !artifactExists(key))) {
      const built = await archiveJob(job.id);
      if (!built) return reply.code(404).send({ error: 'Архив ещё не готов' });
      key = built.key;
      backend = built.backend;
    }
    if (backend === 's3') return reply.redirect(await presignArtifact(key, `code-qr-job-${job.id}.zip`));
    const st = artifactStats(key);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="code-qr-job-${job.id}.zip"`);
    if (st) reply.header('Content-Length', String(st.size));
    return reply.send(openArtifact(key));
  });

  app.get('/api/history', { preHandler: requireAuth }, async (req) => {
    const jobs = db.prepare(
      `SELECT id,name,mode,format,status,total,valid,done,artifact_size,artifact_backend,created_at,finished_at,expires_at,archived_at
       FROM generation_jobs WHERE user_id=? ORDER BY id DESC LIMIT 100`
    ).all(req.user.id);
    const activity = db.prepare(
      `SELECT id,kind,title,status,total,ok_count,fail_count,meta,created_at,expires_at
       FROM activity_log WHERE user_id=? ORDER BY id DESC LIMIT 100`
    ).all(req.user.id).map((a) => {
      let meta = {};
      try { meta = JSON.parse(a.meta || '{}'); } catch { /* ignore */ }
      return { ...a, meta };
    });
    const agg = db.prepare(
      `SELECT COUNT(*) AS jobs, COALESCE(SUM(valid),0) AS codes, COALESCE(SUM(artifact_size),0) AS storage
       FROM generation_jobs WHERE user_id=?`
    ).get(req.user.id);
    const plan = planOf(req.user);
    return {
      jobs,
      activity,
      stats: { jobs: agg.jobs, codes: agg.codes, storage: agg.storage },
      plan: { historyDays: plan.historyDays, archiveMb: plan.archiveMb, formats: plan.formats }
    };
  });

  app.delete('/api/jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const job = ownJob(req, reply);
    if (!job) return;
    await removeJobFiles(job.id);
    db.prepare('DELETE FROM generation_jobs WHERE id=?').run(job.id);
    return { ok: true };
  });
}

