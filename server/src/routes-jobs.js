import { db, today, usageToday } from './db.js';
import { planOf } from './plans.js';
import { requireAuth } from './routes.js';
import { validateRow } from './gs1.js';
import { enqueue, renderSVG, removeJobFiles, JOBS_DIR } from './jobs.js';
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

export function createJobForUser(user, body) {
  const { name, mode = 'cz', format = 'png', rows = [] } = body || {};
  if (!MODES.includes(mode)) return { status: 400, error: 'Неизвестный режим' };
  if (!['png', 'svg'].includes(format)) return { status: 400, error: 'Формат генерации: png или svg' };
  const plan = planOf(user);
  const { error, items } = validateBatch(rows, mode, plan);
  if (error) return { status: 400, error };
  const valid = items.filter(x => x.ok).length;
  if (valid === 0) return { status: 400, error: 'Нет валидных кодов — исправьте данные' };
  const used = usageToday(user.id);
  if (used + valid > plan.codesPerDay) {
    return { status: 403, error: `Дневной лимит: осталось ${Math.max(0, plan.codesPerDay - used)} кодов, нужно ${valid}` };
  }
  const jobId = db.transaction(() => {
    const info = db.prepare('INSERT INTO generation_jobs (user_id, name, mode, format, status, total, valid) VALUES (?,?,?,?,?,?,?)')
      .run(user.id, String(name || 'Без названия').slice(0, 120), mode, format, 'queued', items.length, valid);
    const id = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO job_items (job_id, row_index, raw, normalized, gtin, serial, status, error) VALUES (?,?,?,?,?,?,?,?)');
    for (const it of items) {
      ins.run(id, it.row, it.raw, it.normalized || null, it.gtin || null, it.serial || null, it.ok ? 'ok' : 'invalid', it.error || null);
    }
    db.prepare(`INSERT INTO usage_daily (user_id, day, codes_generated) VALUES (?,?,?)
      ON CONFLICT(user_id, day) DO UPDATE SET codes_generated = codes_generated + excluded.codes_generated`)
      .run(user.id, today(), valid);
    return id;
  })();
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
    const r = createJobForUser(req.user, req.body);
    if (r.error) return reply.code(r.status).send({ error: r.error });
    return { job: r.job };
  });

  app.get('/api/jobs', { preHandler: requireAuth }, async (req) => ({
    jobs: db.prepare('SELECT id,name,mode,format,status,total,valid,done,created_at,finished_at FROM generation_jobs WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id)
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

  app.get('/api/jobs/:id/item/:row.png', { preHandler: requireAuth }, async (req, reply) => {
    if (!isRowIndex(req.params.row)) return reply.code(400).send({ error: 'Некорректный номер строки' });
    const job = ownJob(req, reply);
    if (!job) return;
    const p = join(JOBS_DIR, String(job.id), req.params.row + '.png');
    if (!existsSync(p)) return reply.code(404).send({ error: 'Файл не найден' });
    return reply.type('image/png').send(readFileSync(p));
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
    if (!plan.formats.includes(format)) return reply.code(403).send({ error: `Экспорт ${format.toUpperCase()} доступен на тарифе PREMIUM` });
    if (job.status !== 'done') return reply.code(409).send({ error: 'Генерация ещё не завершена' });
    const items = db.prepare("SELECT * FROM job_items WHERE job_id=? AND status='generated' ORDER BY row_index").all(job.id);
    const fname = `code-qr-job-${job.id}.${format}`;

    if (format === 'zip') {
      reply.hijack();
      reply.raw.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fname}"` });
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(reply.raw);
      for (const it of items) {
        if (job.format === 'svg') archive.append(await renderSVG(it, job.mode), { name: `${it.row_index}.svg` });
        else archive.file(join(JOBS_DIR, String(job.id), it.row_index + '.png'), { name: `${it.row_index}.png` });
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
      doc.image(p, x, y, { width: imgSize, height: imgSize });
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

  app.delete('/api/jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const job = ownJob(req, reply);
    if (!job) return;
    removeJobFiles(job.id);
    db.prepare('DELETE FROM generation_jobs WHERE id=?').run(job.id);
    return { ok: true };
  });
}
