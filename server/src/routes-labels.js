import { db } from './db.js';
import { planOf } from './plans.js';
import { consumeOperations, consumeExports, UsageError, rollbackUsageEvent } from './lib/usage.js';
import { requireAuth } from './routes.js';
import { resolveElements, resolveElementsMany, renderLabelsPdf } from './labels.js';
import PDFDocument from 'pdfkit';
import { createHash, randomUUID } from 'node:crypto';
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
const PDF_CACHE_TOTAL_BYTES = Math.max(16, Number(process.env.PDF_CACHE_MAX_MB) || 96) * 1024 * 1024;
const pdfCache = new Map(); // key -> { buffer, at }
let pdfCacheBytes = 0;

function pdfCacheKey(template, rows, single) {
  return createHash('sha256')
    .update(JSON.stringify({ template, rows, single: Boolean(single) }))
    .digest('hex');
}

function pdfCacheDrop(key) {
  const item = pdfCache.get(key);
  if (!item) return;
  pdfCacheBytes -= item.buffer.length;
  pdfCache.delete(key);
}

function pdfCachePrune() {
  const now = Date.now();
  for (const [key, item] of pdfCache) {
    if (now - item.at > PDF_CACHE_TTL_MS) pdfCacheDrop(key);
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
  while (pdfCache.size >= PDF_CACHE_MAX_ENTRIES) {
    const oldest = pdfCache.keys().next();
    if (oldest.done) break;
    pdfCacheDrop(oldest.value);
  }
  // Общий лимит памяти кэша (на боевом сервере мало RAM).
  while (pdfCache.size && pdfCacheBytes + buffer.length > PDF_CACHE_TOTAL_BYTES) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [k, item] of pdfCache) {
      if (item.at < oldestAt) { oldestAt = item.at; oldestKey = k; }
    }
    if (!oldestKey) break;
    pdfCacheDrop(oldestKey);
  }
  if (pdfCacheBytes + buffer.length > PDF_CACHE_TOTAL_BYTES) return;
  pdfCacheDrop(key);
  pdfCache.set(key, { buffer, at: Date.now() });
  pdfCacheBytes += buffer.length;
}

// Длинные пакеты (сотни и тысячи этикеток) собираются в фоне, а клиент видит
// прогресс и не держит один HTTP-запрос десятки секунд (на мобильных сетях
// такие запросы рвутся по таймауту). Готовый файл отдаётся по короткой ссылке.
const PDF_TASK_TTL_MS = 15 * 60 * 1000;
const PDF_TASK_MAX_PER_USER = 3;
const PDF_TASK_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.PDF_TASK_CONCURRENCY) || 2));
const pdfTasks = new Map(); // id -> task
const pdfTaskQueue = [];
let pdfTasksActive = 0;

function pdfTaskPrune() {
  const now = Date.now();
  for (const [id, task] of pdfTasks) {
    if (now - task.at > PDF_TASK_TTL_MS) pdfTasks.delete(id);
  }
}

function samePdfPrincipal(task, user) {
  return task.userId === user.id && Number(task.memberId || 0) === Number(user.teamMemberId || 0);
}

function pdfTaskCountForUser(user) {
  let count = 0;
  for (const task of pdfTasks.values()) {
    if (samePdfPrincipal(task, user) && (task.status === 'queued' || task.status === 'running')) count += 1;
  }
  return count;
}

function pdfTaskView(task) {
  return {
    id: task.id,
    status: task.status,
    done: task.done,
    total: task.total,
    name: task.name,
    url: task.status === 'ready' ? `/api/labels/pdf/file/${task.ticketId}` : null,
    error: task.status === 'error' ? task.error : null
  };
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
    if (!planOf(req.user).templates) return reply.code(403).send({ error: 'Сохранение шаблонов доступно на тарифе PRO и выше', feature: 'templates' });
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
    if (!planOf(req.user).templates) return reply.code(403).send({ error: 'Сохранение шаблонов доступно на тарифе PRO и выше', feature: 'templates' });
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
    if (!plan.labelEditor) return reply.code(403).send({ error: 'Редактор этикеток доступен на тарифе PRO и выше', feature: 'labelEditor' });
    const { template, jobId, row, data } = req.body || {};
    const err = validateTemplate(template);
    if (err) return reply.code(400).send({ error: err });
    let d = data || {};
    if (jobId != null) {
      const job = db.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=? AND deleted_at IS NULL').get(jobId, req.user.id);
      if (!job) return reply.code(404).send({ error: 'Задание не найдено' });
      const item = db.prepare('SELECT * FROM job_items WHERE job_id=? AND row_index=?').get(job.id, Number(row) || 0);
      if (!item || !item.normalized) return reply.code(404).send({ error: 'Строка задания не найдена' });
      d = { code: item.normalized, gtin: item.gtin, serial: item.serial, row: item.row_index + 1 };
    }
    try {
      const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
      consumeOperations(req.user, 1, { idemKey: idem ? `${idem}:prepare` : '', context: 'print_bridge' });
    } catch (e) {
      if (e instanceof UsageError) return reply.code(e.statusCode || 402).send({ error: e.message, ...e.payload });
      throw e;
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
    const job = db.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=? AND deleted_at IS NULL').get(jobId, user.id);
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

  async function buildLabelsPdf(template, dataRows, singlePage, onProgress = null) {
    const K = 72 / 25.4;
    const pageSize = singlePage ? [Number(template.widthMm) * K, Number(template.heightMm) * K] : 'A4';
    const doc = new PDFDocument({ size: pageSize, margin: 0 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const ended = new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
    });
    await renderLabelsPdf(doc, template, dataRows, { single: singlePage, onProgress, vectorDatamatrix: true });
    doc.end();
    await ended;
    return Buffer.concat(chunks);
  }

  // Один PDF на одинаковый запрос не собираем повторно (см. pdfCache выше).
  async function cachedLabelsPdf(template, dataRows, singlePage, onProgress = null) {
    const key = pdfCacheKey(template, dataRows, singlePage);
    const cached = pdfCacheGet(key);
    if (cached) {
      if (typeof onProgress === 'function') onProgress(dataRows.length, dataRows.length);
      return { pdf: cached, cached: true };
    }
    const pdf = await buildLabelsPdf(template, dataRows, singlePage, onProgress);
    pdfCacheSet(key, pdf);
    return { pdf, cached: false };
  }

  // Общая проверка запроса на PDF: возвращает null, если ответ уже отправлен.
  function preparePdfRequest(req, reply) {
    const { template, single } = req.body || {};
    const err = validateTemplate(template);
    if (err) {
      reply.code(400).send({ error: err });
      return null;
    }
    const singlePage = single === true;
    const dataRows = resolvePdfRows(req.user, req.body, reply);
    if (!dataRows) return null;
    // Одна операция = один код/этикетка в PDF. idemKey защищает от двойного нажатия.
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      consumeOperations(req.user, dataRows.length, { idemKey: idem ? `${idem}:pdf` : '', context: 'labels_pdf' });
      consumeExports(req.user, 1, { idemKey: idem ? `${idem}:pdf_export` : '', context: 'labels_pdf_export' });
    } catch (e) {
      // Если экспорт запрещён лимитом, операции за эту же сборку не должны остаться списанными.
      if (idem) rollbackUsageEvent(req.user.id, `${idem}:pdf`);
      if (e instanceof UsageError) {
        reply.code(e.statusCode || 402).send({ error: e.message, ...e.payload });
        return null;
      }
      throw e;
    }
    return { template, dataRows, singlePage };
  }

  function logPdfActivity(user, req, dataRows, template, singlePage) {
    const isReprint = req.body?.source === 'reprint';
    logActivity(user, 'labels_pdf', isReprint ? 'PDF для повторной печати' : 'PDF этикеток', {
      total: dataRows.length,
      ok: dataRows.length,
      meta: { widthMm: template.widthMm, heightMm: template.heightMm, single: singlePage, jobId: req.body?.jobId ?? null }
    });
  }

  // Очередь фоновых сборок PDF (не больше PDF_TASK_CONCURRENCY одновременно).
  function pumpPdfTasks() {
    while (pdfTasksActive < PDF_TASK_CONCURRENCY && pdfTaskQueue.length) {
      const task = pdfTaskQueue.shift();
      if (task.status !== 'queued') continue;
      pdfTasksActive += 1;
      runPdfTask(task).finally(() => {
        pdfTasksActive -= 1;
        pumpPdfTasks();
      });
    }
  }

  async function runPdfTask(task) {
    task.status = 'running';
    task.at = Date.now();
    try {
      const pdf = await (async () => {
        const key = pdfCacheKey(task.template, task.dataRows, task.singlePage);
        const cached = pdfCacheGet(key);
        if (cached) {
          task.done = task.total;
          return cached;
        }
        const built = await buildLabelsPdf(task.template, task.dataRows, task.singlePage, (done, total) => {
          task.done = done;
          task.total = total;
        });
        pdfCacheSet(key, built);
        return built;
      })();
      const ticketId = putPdfTicket(task.userId, pdf, task.name, task.memberId || null);
      if (!ticketId) throw new Error('Файл слишком большой — уменьшите количество этикеток');
      task.ticketId = ticketId;
      task.done = task.total;
      task.status = 'ready';
      try { logPdfActivity(task.user, task.reqSnapshot, task.dataRows, task.template, task.singlePage); } catch { /* ignore */ }
    } catch (e) {
      task.status = 'error';
      task.error = String(e?.message || e);
      // Фоновая сборка не должна съедать лимит при ошибке/недостатке места.
      if (task.idemKey) {
        try {
          rollbackUsageEvent(task.userId, `${task.idemKey}:pdf`);
          rollbackUsageEvent(task.userId, `${task.idemKey}:pdf_export`);
        } catch { /* не меняем исходную ошибку задачи */ }
      }
    }
    task.at = Date.now();
  }

  // PDF-лист А4 с сеткой этикеток по всем сгенерированным строкам задания
  app.post('/api/labels/pdf', { preHandler: requireAuth }, async (req, reply) => {
    const prepared = preparePdfRequest(req, reply);
    if (!prepared) return reply;
    const { template, dataRows, singlePage } = prepared;
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      const { pdf } = await cachedLabelsPdf(template, dataRows, singlePage);
      logPdfActivity(req.user, req, dataRows, template, singlePage);
      reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="labels.pdf"');
    reply.header('Content-Length', String(pdf.length));
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(pdf);
    } catch (e) {
      if (idem) {
        rollbackUsageEvent(req.user.id, `${idem}:pdf`);
        rollbackUsageEvent(req.user.id, `${idem}:pdf_export`);
      }
      throw e;
    }
  });

  // Задание на PDF с прогрессом: клиент опрашивает статус и показывает полосу
  // «готово N из M этикеток», а не ждёт один длинный ответ.
  app.post('/api/labels/pdf/task', { preHandler: requireAuth }, async (req, reply) => {
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    // Повторная отправка после таймаута отдаёт уже существующее задание, а не
    // создаёт новую платную сборку.
    if (idem) {
      for (const task of pdfTasks.values()) {
        if (task.idemKey === idem && samePdfPrincipal(task, req.user)) return { ...pdfTaskView(task), duplicated: true };
      }
    }
    const prepared = preparePdfRequest(req, reply);
    if (!prepared) return reply;
    pdfTaskPrune();
    if (pdfTaskCountForUser(req.user) >= PDF_TASK_MAX_PER_USER) {
      return reply.code(429).send({ error: 'Предыдущая подготовка PDF ещё идёт — дождитесь её окончания' });
    }
    const { template, dataRows, singlePage } = prepared;
    const task = {
      id: randomUUID().replace(/-/g, ''),
      userId: req.user.id,
      memberId: req.user.teamMemberId || null,
      user: req.user,
      template,
      dataRows,
      singlePage,
      name: req.body?.source === 'reprint' ? 'reprint.pdf' : 'labels.pdf',
      idemKey: String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100),
      status: 'queued',
      done: 0,
      total: dataRows.length,
      ticketId: null,
      error: null,
      at: Date.now(),
      reqSnapshot: { body: { source: req.body?.source, jobId: req.body?.jobId ?? null } }
    };
    pdfTasks.set(task.id, task);
    pdfTaskQueue.push(task);
    pumpPdfTasks();
    return { ...pdfTaskView(task), queued: true };
  });

  app.get('/api/labels/pdf/task/:id', { preHandler: requireAuth }, async (req, reply) => {
    pdfTaskPrune();
    const task = pdfTasks.get(String(req.params.id || ''));
    if (!task || !samePdfPrincipal(task, req.user)) {
      return reply.code(404).send({ error: 'Задание не найдено — сформируйте PDF заново' });
    }
    // если файл по тикету уже истёк — считаем задание устаревшим.
    if (task.status === 'ready' && !getPdfTicket(task.ticketId, req.user.id, req.user.teamMemberId || null)) {
      task.status = 'error';
      task.error = 'Файл устарел — сформируйте PDF заново';
    }
    return pdfTaskView(task);
  });

  // PDF через короткоживущую ссылку: нужен для iOS Safari, который не умеет
  // открывать PDF из blob: и не сохраняет их через download.
  app.post('/api/labels/pdf/ticket', { preHandler: requireAuth }, async (req, reply) => {
    const prepared = preparePdfRequest(req, reply);
    if (!prepared) return reply;
    const { template, dataRows, singlePage } = prepared;
    const name = req.body?.source === 'reprint' ? 'reprint.pdf' : 'labels.pdf';
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      const pdf = (await cachedLabelsPdf(template, dataRows, singlePage)).pdf;
      const id = putPdfTicket(req.user.id, pdf, name, req.user.teamMemberId || null);
      if (!id) {
        if (idem) {
          rollbackUsageEvent(req.user.id, `${idem}:pdf`);
          rollbackUsageEvent(req.user.id, `${idem}:pdf_export`);
        }
        return reply.code(413).send({ error: 'Файл слишком большой — уменьшите количество этикеток' });
      }
      logPdfActivity(req.user, req, dataRows, template, singlePage);
      return { id, url: `/api/labels/pdf/file/${id}`, name };
    } catch (e) {
      if (idem) {
        rollbackUsageEvent(req.user.id, `${idem}:pdf`);
        rollbackUsageEvent(req.user.id, `${idem}:pdf_export`);
      }
      throw e;
    }
  });

  app.get('/api/labels/pdf/file/:id', { preHandler: requireAuth }, async (req, reply) => {
    const item = getPdfTicket(req.params.id, req.user.id, req.user.teamMemberId || null);
    if (!item) return reply.code(404).send({ error: 'Ссылка устарела или недоступна — сформируйте PDF заново' });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${item.name}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(item.buffer);
  });

  // HTML-версия для печати прямо из браузера (без скачивания PDF)
  app.post('/api/labels/print', { preHandler: requireAuth }, async (req, reply) => {
    const plan = planOf(req.user);
    if (!plan.labelEditor) return reply.code(403).send({ error: 'Печать этикеток доступна на тарифе PRO и выше', feature: 'labelEditor' });
    const { template, jobId, rows } = req.body || {};
    const err = validateTemplate(template);
    if (err) return reply.code(400).send({ error: err });
    let dataRows;
    if (Array.isArray(rows)) {
      dataRows = cleanDataRows(rows);
      if (!dataRows) return reply.code(400).send({ error: 'Нужны строки данных (до 10 000)' });
    } else {
      if (jobId == null) return reply.code(400).send({ error: 'Выберите пакет или загрузите данные' });
      const job = db.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=? AND deleted_at IS NULL').get(jobId, req.user.id);
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
