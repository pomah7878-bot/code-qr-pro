import { db } from './db.js';
import { planOf } from './plans.js';
import { requireAuth } from './routes.js';
import { resolveElements, resolveElementsMany, renderLabelsPdf } from './labels.js';
import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import { logActivity } from './lib/activity.js';
import { labelHtml, printDocument } from './lib/print-html.js';
import { putPdfTicket, getPdfTicket } from './lib/pdf-tickets.js';

const EL_TYPES = ['datamatrix', 'code128', 'ean13', 'ean8', 'upca', 'code39', 'itf14', 'gs1_128', 'pdf417', 'qrcode', 'text', 'field'];

// Готовый PDF одного и того же пакета (шаблон + строки) отдаём из памяти:
// повторное «Скачать PDF» на /app/reprint раньше заново кодировало все
// DataMatrix — секунды ожидания без всякой пользы.
const PDF_CACHE_TTL_MS = 10 * 60 * 1000;
const PDF_CACHE_MAX_ENTRIES = 24;
const PDF_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const pdfCache = new Map(); // key -> { buffer, at }

function pdfCacheKey(template, rows, single) {
  return createHash('sha256')
    .update(JSON.stringify({ template, rows, single: Boolean(single) }))
    .digest('hex');
}

function pdfCachePrune() {
  const now = Date.now();
  for (const [key, item] of pdfCache) {
    if (now - item.at > PDF_CACHE_TTL_MS) pdfCache.delete(key);
  }
}

function pdfCacheGet(key) {
  pdfCachePrune();
  const item = pdfCache.get(key);
  if (!item) return null;
  item.at = Date.now(); // продлеваем жизнь часто запрашиваемого файла
  return item.buffer;
}

function pdfCacheSet(key, buffer) {
  if (!buffer || buffer.length > PDF_CACHE_MAX_BYTES) return;
  pdfCachePrune();
  if (pdfCache.size >= PDF_CACHE_MAX_ENTRIES) {
    const oldest = pdfCache.keys().next();
    if (!oldest.done) pdfCache.delete(oldest.value);
  }
  pdfCache.set(key, { buffer, at: Date.now() });
}

function validateTemplate(t) {
  if (!t || typeof t !== 'object') return 'Шаблон не передан';
  if (!t.name || String(t.name).length > 100) return 'Название до 100 символов';
  const w = Number(t.widthMm), h = Number(t.heightMm);
  if (!(w >= 10 && w <= 210) || !(h >= 10 && h <= 297)) return 'Размер этикетки: 10–210 × 10–297 мм';
  if (![203, 300].includes(Number(t.dpi))) return 'DPI: 203 или 300';
  if (!Array.isArray(t.elements) || t.elements.length > 50) return 'До 50 элементов';
  for (const el of t.elements) {
    if (!EL_TYPES.includes(el.type)) return 'Неизвестный тип элемента';
    for (const k of ['x', 'y', 'w', 'h']) {
      const v = Number(el[k]);
      if (!Number.isFinite(v) || v < 0 || v > 300) return `Некорректное поле ${k} у элемента`;
    }
  }
  return null;
}

const rowToTemplate = (r) => ({ id: r.id, name: r.name, widthMm: r.width_mm, heightMm: r.height_mm, dpi: r.dpi, elements: JSON.parse(r.elements), updatedAt: r.updated_at });

function cleanDataRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) return null;
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const row = {};
    for (const [k, v] of Object.entries(r)) {
      if (!/^[^\x00-\x1f]{1,40}$/.test(k)) continue;
      row[k] = String(v ?? '').slice(0, 1000);
      if (Object.keys(row).length >= 30) break;
    }
    if (Object.keys(row).length) out.push(row);
  }
  return out.length ? out : null;
}

export async function registerLabelRoutes(app) {
  app.get('/api/templates', { preHandler: requireAuth }, async (req) => ({
    templates: db.prepare('SELECT * FROM label_templates WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(rowToTemplate)
  }));

  app.post('/api/templates', { preHandler: requireAuth }, async (req, reply) => {
    const t = req.body || {};
    const err = validateTemplate(t);
    if (err) return reply.code(400).send({ error: err });
    const info = db.prepare('INSERT INTO label_templates (user_id, name, width_mm, height_mm, dpi, elements) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, String(t.name).slice(0, 100), Number(t.widthMm), Number(t.heightMm), Number(t.dpi), JSON.stringify(t.elements));
    return { template: rowToTemplate(db.prepare('SELECT * FROM label_templates WHERE id=?').get(info.lastInsertRowid)) };
  });

  const ownTemplate = (req, reply) => {
    const r = db.prepare('SELECT * FROM label_templates WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!r) { reply.code(404).send({ error: 'Шаблон не найден' }); return null; }
    return r;
  };

  app.put('/api/templates/:id', { preHandler: requireAuth }, async (req, reply) => {
    const r = ownTemplate(req, reply);
    if (!r) return;
    const t = req.body || {};
    const err = validateTemplate(t);
    if (err) return reply.code(400).send({ error: err });
    db.prepare("UPDATE label_templates SET name=?, width_mm=?, height_mm=?, dpi=?, elements=?, updated_at=datetime('now') WHERE id=?")
      .run(String(t.name).slice(0, 100), Number(t.widthMm), Number(t.heightMm), Number(t.dpi), JSON.stringify(t.elements), r.id);
    return { template: rowToTemplate(db.prepare('SELECT * FROM label_templates WHERE id=?').get(r.id)) };
  });

  app.delete('/api/templates/:id', { preHandler: requireAuth }, async (req, reply) => {
    const r = ownTemplate(req, reply);
    if (!r) return;
    db.prepare('DELETE FROM label_templates WHERE id=?').run(r.id);
    return { ok: true };
  });

  // Подготовка этикетки к печати: тексты + PNG штрихкодов для Print Bridge
  app.post('/api/labels/prepare', { preHandler: requireAuth }, async (req, reply) => {
    const plan = planOf(req.user);
    if (!plan.labelEditor) return reply.code(403).send({ error: 'Редактор этикеток доступен на тарифе PREMIUM' });
    const { template, jobId, row, data } = req.body || {};
    const err = validateTemplate(template);
    if (err) return reply.code(400).send({ error: err });
    let d = data || {};
    if (jobId != null) {
      const job = db.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=?').get(jobId, req.user.id);
      if (!job) return reply.code(404).send({ error: 'Задание не найдено' });
      const item = db.prepare('SELECT * FROM job_items WHERE job_id=? AND row_index=?').get(job.id, Number(row) || 0);
      if (!item || !item.normalized) return reply.code(404).send({ error: 'Строка задания не найдена' });
      d = { code: item.normalized, gtin: item.gtin, serial: item.serial, row: item.row_index + 1 };
    }
    const elements = (await resolveElements(template, d)).map((el) => {
      // В JSON отдаём привычный pngBase64 (Buffer внутри элемента не сериализуется).
      const { pngBuffer, ...rest } = el;
      return pngBuffer ? { ...rest, pngBase64: pngBuffer.toString('base64') } : rest;
    });
    return { widthMm: Number(template.widthMm), heightMm: Number(template.heightMm), dpi: Number(template.dpi), elements };
  });

  // Подготовка набора строк для PDF: либо готовые rows, либо строки задания.
  function resolvePdfRows(user, body, reply) {
    const { jobId, rows } = body || {};
    if (Array.isArray(rows)) {
      const dataRows = cleanDataRows(rows);
      if (!dataRows) {
        reply.code(400).send({ error: 'Нужны строки данных (до 10 000)' });
        return null;
      }
      return dataRows;
    }
    if (jobId == null) {
      reply.code(400).send({ error: 'Выберите пакет или загрузите данные' });
      return null;
    }
    const job = db.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=?').get(jobId, user.id);
    if (!job) {
      reply.code(404).send({ error: 'Задание не найдено' });
      return null;
    }
    if (job.status !== 'done') {
      reply.code(409).send({ error: 'Генерация ещё не завершена' });
      return null;
    }
    const items = db.prepare("SELECT * FROM job_items WHERE job_id=? AND status='generated' ORDER BY row_index").all(job.id);
    return items.map((item) => ({ code: item.normalized, gtin: item.gtin, serial: item.serial, row: String(item.row_index + 1) }));
  }

  async function buildLabelsPdf(template, dataRows, singlePage) {
    const K = 72 / 25.4;
    const pageSize = singlePage ? [Number(template.widthMm) * K, Number(template.heightMm) * K] : 'A4';
    const doc = new PDFDocument({ size: pageSize, margin: 0 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const ended = new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
    });
    await renderLabelsPdf(doc, template, dataRows, { single: singlePage });
    doc.end();
    await ended;
    return Buffer.concat(chunks);
  }

  // Один PDF на одинаковый запрос не собираем повторно (см. pdfCache выше).
  async function cachedLabelsPdf(template, dataRows, singlePage) {
    const key = pdfCacheKey(template, dataRows, singlePage);
    const cached = pdfCacheGet(key);
    if (cached) return { pdf: cached, cached: true };
    const pdf = await buildLabelsPdf(template, dataRows, singlePage);
    pdfCacheSet(key, pdf);
    return { pdf, cached: false };
  }

  // PDF-лист А4 с сеткой этикеток по всем сгенерированным строкам задания
  app.post('/api/labels/pdf', { preHandler: requireAuth }, async (req, reply) => {
    const plan = planOf(req.user);
    if (!plan.labelEditor) return reply.code(403).send({ error: 'Экспорт этикеток доступен на тарифе PREMIUM' });
    const { template, single } = req.body || {};
    const err = validateTemplate(template);
    if (err) return reply.code(400).send({ error: err });
    const singlePage = single === true;
    const dataRows = resolvePdfRows(req.user, req.body, reply);
    if (!dataRows) return reply;
    const { pdf } = await cachedLabelsPdf(template, dataRows, singlePage);
    logActivity(req.user, 'labels_pdf', req.body?.source === 'reprint' ? 'PDF для повторной печати' : 'PDF этикеток', {
      total: dataRows.length,
      ok: dataRows.length,
      meta: { widthMm: template.widthMm, heightMm: template.heightMm, single: singlePage, jobId: req.body?.jobId ?? null }
    });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="labels.pdf"');
    reply.header('Content-Length', String(pdf.length));
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(pdf);
  });

  // PDF через короткоживущую ссылку: нужен для iOS Safari, который не умеет
  // открывать PDF из blob: и не сохраняет их через download.
  app.post('/api/labels/pdf/ticket', { preHandler: requireAuth }, async (req, reply) => {
    const plan = planOf(req.user);
    if (!plan.labelEditor) return reply.code(403).send({ error: 'Экспорт этикеток доступен на тарифе PREMIUM' });
    const { template, single } = req.body || {};
    const err = validateTemplate(template);
    if (err) return reply.code(400).send({ error: err });
    const dataRows = resolvePdfRows(req.user, req.body, reply);
    if (!dataRows) return reply;
    const singlePage = single === true;
    const { pdf } = await cachedLabelsPdf(template, dataRows, singlePage);
    const name = req.body?.source === 'reprint' ? 'reprint.pdf' : 'labels.pdf';
    const id = putPdfTicket(req.user.id, pdf, name);
    if (!id) return reply.code(413).send({ error: 'Файл слишком большой — уменьшите количество этикеток' });
    logActivity(req.user, 'labels_pdf', req.body?.source === 'reprint' ? 'PDF для повторной печати' : 'PDF этикеток', {
      total: dataRows.length,
      ok: dataRows.length,
      meta: { widthMm: template.widthMm, heightMm: template.heightMm, single: singlePage, jobId: req.body?.jobId ?? null }
    });
    return { id, url: `/api/labels/pdf/file/${id}`, name };
  });

  app.get('/api/labels/pdf/file/:id', { preHandler: requireAuth }, async (req, reply) => {
    const item = getPdfTicket(req.params.id, req.user.id);
    if (!item) return reply.code(404).send({ error: 'Ссылка устарела — сформируйте PDF заново' });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${item.name}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(item.buffer);
  });

  // HTML-версия для печати прямо из браузера (без скачивания PDF)
  app.post('/api/labels/print', { preHandler: requireAuth }, async (req, reply) => {
    const plan = planOf(req.user);
    if (!plan.labelEditor) return reply.code(403).send({ error: 'Печать этикеток доступна на тарифе PREMIUM' });
    const { template, jobId, rows } = req.body || {};
    const err = validateTemplate(template);
    if (err) return reply.code(400).send({ error: err });
    let dataRows;
    if (Array.isArray(rows)) {
      dataRows = cleanDataRows(rows);
      if (!dataRows) return reply.code(400).send({ error: 'Нужны строки данных (до 10 000)' });
    } else {
      if (jobId == null) return reply.code(400).send({ error: 'Выберите пакет или загрузите данные' });
      const job = db.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=?').get(jobId, req.user.id);
      if (!job) return reply.code(404).send({ error: 'Задание не найдено' });
      if (job.status !== 'done') return reply.code(409).send({ error: 'Генерация ещё не завершена' });
      const items = db.prepare("SELECT * FROM job_items WHERE job_id=? AND status='generated' ORDER BY row_index").all(job.id);
      dataRows = items.map((item) => ({ code: item.normalized, gtin: item.gtin, serial: item.serial, row: String(item.row_index + 1) }));
    }
    if (dataRows.length > 1000) return reply.code(400).send({ error: 'Для печати из браузера — до 1000 этикеток' });
    const labels = [];
    // Штрихкоды пачки кодируются параллельно в воркерах: окно печати готовится
    // заметно быстрее, а сервер не замирает на время подготовки макета.
    const CHUNK = Math.max(20, Number(process.env.LABELS_PRINT_CHUNK || 120));
    for (let start = 0; start < dataRows.length; start += CHUNK) {
      const resolved = await resolveElementsMany(template, dataRows.slice(start, start + CHUNK));
      for (const els of resolved) labels.push(labelHtml(els, Number(template.widthMm), Number(template.heightMm)));
    }
    logActivity(req.user, 'labels_print', 'Печать этикеток из браузера', {
      total: dataRows.length, ok: dataRows.length,
      meta: { widthMm: template.widthMm, heightMm: template.heightMm, jobId: jobId ?? null }
    });
    return reply.type('text/html; charset=utf-8').send(printDocument({
      labels,
      widthMm: Number(template.widthMm),
      heightMm: Number(template.heightMm),
      title: 'Печать этикеток'
    }));
  });
}
