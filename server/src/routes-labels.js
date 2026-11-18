import { db } from './db.js';
import { planOf } from './plans.js';
import { requireAuth } from './routes.js';
import { resolveElements, renderLabelsPdf } from './labels.js';
import PDFDocument from 'pdfkit';

const EL_TYPES = ['datamatrix', 'code128', 'ean13', 'ean8', 'upca', 'code39', 'itf14', 'gs1_128', 'pdf417', 'qrcode', 'text', 'field'];

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
    const elements = await resolveElements(template, d);
    return { widthMm: Number(template.widthMm), heightMm: Number(template.heightMm), dpi: Number(template.dpi), elements };
  });

  // PDF-лист А4 с сеткой этикеток по всем сгенерированным строкам задания
  app.post('/api/labels/pdf', { preHandler: requireAuth }, async (req, reply) => {
    const plan = planOf(req.user);
    if (!plan.labelEditor) return reply.code(403).send({ error: 'Экспорт этикеток доступен на тарифе PREMIUM' });
    const { template, jobId, rows, single } = req.body || {};
    const err = validateTemplate(template);
    if (err) return reply.code(400).send({ error: err });
    const singlePage = single === true;
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
    const K = 72 / 25.4;
    const pageSize = singlePage ? [Number(template.widthMm) * K, Number(template.heightMm) * K] : 'A4';
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="labels.pdf"` });
    const doc = new PDFDocument({ size: pageSize, margin: 0 });
    doc.pipe(reply.raw);
    await renderLabelsPdf(doc, template, dataRows, { single: singlePage });
    doc.end();
    return reply;
  });
}
