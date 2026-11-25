// Раздел «Маркетплейсы»: товары, профили этикеток, генерация PDF и печать
// оригиналов площадок. Доступ — все клиенты, лимиты по тарифу (usage.js).
// Размеры и поля берутся из версионируемых профилей (marketplaces.js),
// оригинальные PDF/PNG печатаются без перерисовки содержимого.

import { db } from './db.js';
import { requireAuth } from './routes.js';
import { consumeOperations, consumeExports, UsageError, rollbackUsageEvent } from './lib/usage.js';
import { resolveElements, resolveElementsMany, renderLabelsPdfBuffer } from './labels.js';
import { labelHtml, printDocument } from './lib/print-html.js';
import { logActivity } from './lib/activity.js';
import { putPdfTicket, getPdfTicket } from './lib/pdf-tickets.js';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARKETPLACES, isMarketplace, publicProfiles, profileById,
  validateProduct, toDataRow, buildTemplate, PRODUCT_FIELDS
} from './marketplaces.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = dirname(process.env.DB_PATH || join(__dirname, '..', 'data', 'app.db'));
const DOCS_DIR = process.env.MP_DOCS_DIR || join(DATA_DIR, 'marketplace-docs');
mkdirSync(DOCS_DIR, { recursive: true });

const MAX_UPLOAD = 20 * 1024 * 1024;
const MAX_DOCS_PER_USER = 300;
const MAX_COPIES_PDF = 500;
const MAX_COPIES_PRINT = 200;

const docPath = (id) => join(DOCS_DIR, String(id) + '.bin');
const safeFilename = (name) => String(name || 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'document';

function cleanFields(body) {
  const out = {};
  for (const key of PRODUCT_FIELDS) out[key] = String(body?.[key] ?? '').trim().slice(0, 1000);
  return out;
}

function ownProduct(req, reply) {
  const row = db.prepare('SELECT * FROM marketplace_products WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
  if (!row) { reply.code(404).send({ error: 'Товар не найден' }); return null; }
  return row;
}

function productView(r) {
  return {
    id: r.id, marketplace: r.marketplace, name: r.name, manufacturer: r.manufacturer,
    producedAt: r.produced_at, brand: r.brand, sku: r.sku, gtin: r.gtin, barcode: r.barcode,
    size: r.size, color: r.color, composition: r.composition, batch: r.batch,
    expiresAt: r.expires_at, code: r.code, archived: Boolean(r.archived),
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

// Данные товара: из сохранённого товара и/или переданных полей.
function resolveFields(req, reply) {
  const body = req.body || {};
  let fields = cleanFields(body.fields || {});
  if (body.productId != null && body.productId !== '') {
    const row = db.prepare('SELECT * FROM marketplace_products WHERE id=? AND user_id=?').get(Number(body.productId), req.user.id);
    if (!row) { reply.code(404).send({ error: 'Товар не найден' }); return null; }
    const saved = {
      name: row.name, manufacturer: row.manufacturer, produced_at: row.produced_at,
      brand: row.brand, sku: row.sku, gtin: row.gtin, barcode: row.barcode,
      size: row.size, color: row.color, composition: row.composition,
      batch: row.batch, expires_at: row.expires_at, code: row.code
    };
    for (const key of PRODUCT_FIELDS) if (!fields[key]) fields[key] = String(saved[key] || '');
  }
  return fields;
}

function readyProfile(req, reply, { generatable = true } = {}) {
  const profile = profileById(req.body?.profileId);
  if (!profile) { reply.code(400).send({ error: 'Выберите профиль этикетки' }); return null; }
  if (profile.requiresCheck) { reply.code(400).send({ error: 'Профиль «Требует проверки» — печать недоступна, используйте оригинал из кабинета площадки' }); return null; }
  if (generatable && !profile.generatable) { reply.code(400).send({ error: 'Этот профиль печатается только из оригинала площадки (загрузка PDF/PNG)' }); return null; }
  return profile;
}

function usageErrorReply(reply, e) {
  if (e instanceof UsageError) return reply.code(e.statusCode || 402).send({ error: e.message, ...e.payload });
  throw e;
}

export async function registerMarketplaceRoutes(app) {
  // Загрузка оригиналов: сырой буфер PDF/PNG (без multipart-зависимостей).
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer' }, (req, body, done) => done(null, body));
  app.addContentTypeParser('image/png', { parseAs: 'buffer' }, (req, body, done) => done(null, body));

  app.get('/api/marketplaces/overview', { preHandler: requireAuth }, async (req) => ({
    markets: MARKETPLACES,
    profiles: publicProfiles(),
    productsCount: db.prepare('SELECT COUNT(*) n FROM marketplace_products WHERE user_id=? AND archived=0').get(req.user.id).n,
    documentsCount: db.prepare('SELECT COUNT(*) n FROM marketplace_documents WHERE user_id=?').get(req.user.id).n
  }));

  // --- Товары ---
  app.get('/api/marketplaces/products', { preHandler: requireAuth }, async (req) => {
    const query = String(req.query.query || '').trim().slice(0, 100);
    const marketplace = String(req.query.marketplace || '');
    const archived = req.query.archived === '1' ? 1 : 0;
    let sql = 'SELECT * FROM marketplace_products WHERE user_id=? AND archived=?';
    const params = [req.user.id, archived];
    if (marketplace && isMarketplace(marketplace)) { sql += ' AND marketplace=?'; params.push(marketplace); }
    if (query) {
      sql += ' AND (name LIKE ? OR sku LIKE ? OR gtin LIKE ? OR barcode LIKE ?)';
      const like = '%' + query.replace(/[%_]/g, '') + '%';
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY id DESC LIMIT 200';
    return { products: db.prepare(sql).all(...params).map(productView) };
  });

  app.post('/api/marketplaces/products', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 200);
    if (!name) return reply.code(400).send({ error: 'Укажите наименование изделия' });
    const marketplace = isMarketplace(body.marketplace) ? String(body.marketplace) : '';
    const f = cleanFields(body);
    if (body.id != null && body.id !== '') {
      const row = ownProduct(req, reply);
      if (!row) return reply;
      db.prepare("UPDATE marketplace_products SET marketplace=?, name=?, manufacturer=?, produced_at=?, brand=?, sku=?, gtin=?, barcode=?, size=?, color=?, composition=?, batch=?, expires_at=?, code=?, updated_at=datetime('now') WHERE id=?")
        .run(marketplace, name, f.manufacturer, f.produced_at, f.brand, f.sku, f.gtin, f.barcode, f.size, f.color, f.composition, f.batch, f.expires_at, f.code, row.id);
      return { product: productView(db.prepare('SELECT * FROM marketplace_products WHERE id=?').get(row.id)) };
    }
    const count = db.prepare('SELECT COUNT(*) n FROM marketplace_products WHERE user_id=? AND archived=0').get(req.user.id).n;
    if (count >= 1000) return reply.code(409).send({ error: 'Достигнут лимит 1000 товаров — удалите или архивируйте старые' });
    const info = db.prepare('INSERT INTO marketplace_products (user_id, marketplace, name, manufacturer, produced_at, brand, sku, gtin, barcode, size, color, composition, batch, expires_at, code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.user.id, marketplace, name, f.manufacturer, f.produced_at, f.brand, f.sku, f.gtin, f.barcode, f.size, f.color, f.composition, f.batch, f.expires_at, f.code);
    return reply.code(201).send({ product: productView(db.prepare('SELECT * FROM marketplace_products WHERE id=?').get(info.lastInsertRowid)) });
  });

  app.post('/api/marketplaces/products/:id/archive', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownProduct(req, reply);
    if (!row) return reply;
    db.prepare("UPDATE marketplace_products SET archived=1, updated_at=datetime('now') WHERE id=?").run(row.id);
    return { ok: true };
  });

  app.delete('/api/marketplaces/products/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownProduct(req, reply);
    if (!row) return reply;
    db.prepare('DELETE FROM marketplace_products WHERE id=?').run(row.id);
    return { ok: true };
  });

  // --- Предпросмотр: реальные штрихкоды + проверка полей ---
  app.post('/api/marketplaces/labels/preview', { preHandler: requireAuth }, async (req, reply) => {
    const profile = readyProfile(req, reply);
    if (!profile) return reply;
    const fields = resolveFields(req, reply);
    if (!fields) return reply;
    const { problems, warnings } = validateProduct(profile, fields);
    const row = toDataRow(fields);
    const elements = (await resolveElements(buildTemplate(profile), row)).map((el) => {
      const { pngBuffer, ...rest } = el;
      return pngBuffer ? { ...rest, pngBase64: pngBuffer.toString('base64') } : rest;
    });
    return {
      widthMm: profile.widthMm, heightMm: profile.heightMm,
      elements, fields: row, problems, warnings, canPrint: problems.length === 0
    };
  });

  // --- PDF: страница точного размера или лист А4 ---
  // Подготовка общая для /pdf и /pdf/ticket (короткая ссылка для iOS Safari).
  function prepareLabelPdf(req, reply) {
    const profile = readyProfile(req, reply);
    if (!profile) return null;
    const fields = resolveFields(req, reply);
    if (!fields) return null;
    const { problems } = validateProduct(profile, fields);
    if (problems.length) { reply.code(400).send({ error: problems[0], problems }); return null; }
    const copies = Math.max(1, Math.min(MAX_COPIES_PDF, Math.round(Number(req.body?.copies) || 1)));
    const mode = req.body?.mode === 'a4' ? 'a4' : 'label';
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      consumeOperations(req.user, copies, { idemKey: idem ? idem + ':mp_pdf' : '', context: 'marketplaces_pdf' });
      consumeExports(req.user, 1, { idemKey: idem ? idem + ':mp_pdf_export' : '', context: 'marketplaces_pdf_export' });
    } catch (e) {
      if (idem) rollbackUsageEvent(req.user.id, idem + ':mp_pdf');
      usageErrorReply(reply, e);
      return null;
    }
    return { profile, fields, copies, mode, idem };
  }

  function rollbackPdf(user, idem) {
    if (!idem) return;
    rollbackUsageEvent(user.id, idem + ':mp_pdf');
    rollbackUsageEvent(user.id, idem + ':mp_pdf_export');
  }

  async function buildMpPdf(prep) {
    const row = toDataRow(prep.fields);
    const rows = Array.from({ length: prep.copies }, () => row);
    return renderLabelsPdfBuffer(buildTemplate(prep.profile), rows, { single: prep.mode !== 'a4' });
  }

  app.post('/api/marketplaces/labels/pdf', { preHandler: requireAuth }, async (req, reply) => {
    const prep = prepareLabelPdf(req, reply);
    if (!prep) return reply;
    try {
      const pdf = await buildMpPdf(prep);
      logActivity(req.user, 'marketplaces_pdf', 'PDF этикетки маркетплейса', {
        total: prep.copies, ok: prep.copies,
        meta: { marketplace: prep.profile.marketplace, profileId: prep.profile.id, mode: prep.mode }
      });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'attachment; filename="marketplace-' + prep.profile.id + '.pdf"');
      reply.header('Content-Length', String(pdf.length));
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(pdf);
    } catch (e) {
      rollbackPdf(req.user, prep.idem);
      throw e;
    }
  });

  app.post('/api/marketplaces/labels/pdf/ticket', { preHandler: requireAuth }, async (req, reply) => {
    const prep = prepareLabelPdf(req, reply);
    if (!prep) return reply;
    try {
      const pdf = await buildMpPdf(prep);
      const name = 'marketplace-' + prep.profile.id + '.pdf';
      const id = putPdfTicket(req.user.id, pdf, name, req.user.teamMemberId || null);
      if (!id) {
        rollbackPdf(req.user, prep.idem);
        return reply.code(413).send({ error: 'Файл слишком большой — уменьшите количество этикеток' });
      }
      logActivity(req.user, 'marketplaces_pdf', 'PDF этикетки маркетплейса', {
        total: prep.copies, ok: prep.copies,
        meta: { marketplace: prep.profile.marketplace, profileId: prep.profile.id, mode: prep.mode }
      });
      return { id, url: '/api/marketplaces/labels/pdf/file/' + id, name };
    } catch (e) {
      rollbackPdf(req.user, prep.idem);
      throw e;
    }
  });

  app.get('/api/marketplaces/labels/pdf/file/:id', { preHandler: requireAuth }, async (req, reply) => {
    const item = getPdfTicket(req.params.id, req.user.id, req.user.teamMemberId || null);
    if (!item) return reply.code(404).send({ error: 'Ссылка устарела или недоступна — сформируйте PDF заново' });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'inline; filename="' + safeFilename(item.name) + '"');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(item.buffer);
  });

  // --- HTML-печать из браузера (системный диалог) ---
  app.post('/api/marketplaces/labels/print', { preHandler: requireAuth }, async (req, reply) => {
    const profile = readyProfile(req, reply);
    if (!profile) return reply;
    const fields = resolveFields(req, reply);
    if (!fields) return reply;
    const { problems } = validateProduct(profile, fields);
    if (problems.length) return reply.code(400).send({ error: problems[0], problems });
    const copies = Math.max(1, Math.min(MAX_COPIES_PRINT, Math.round(Number(req.body?.copies) || 1)));
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      consumeOperations(req.user, copies, { idemKey: idem ? idem + ':mp_print' : '', context: 'marketplaces_print' });
    } catch (e) { return usageErrorReply(reply, e); }
    try {
      const template = buildTemplate(profile);
      const row = toDataRow(fields);
      const rows = Array.from({ length: copies }, () => row);
      const labels = [];
      const CHUNK = 120;
      for (let start = 0; start < rows.length; start += CHUNK) {
        const resolved = await resolveElementsMany(template, rows.slice(start, start + CHUNK));
        for (const els of resolved) labels.push(labelHtml(els, profile.widthMm, profile.heightMm));
      }
      logActivity(req.user, 'marketplaces_print', 'Печать этикетки маркетплейса', {
        total: copies, ok: copies, meta: { marketplace: profile.marketplace, profileId: profile.id }
      });
      return reply.type('text/html; charset=utf-8').send(printDocument({
        labels, widthMm: profile.widthMm, heightMm: profile.heightMm,
        title: 'Печать · ' + profile.name
      }));
    } catch (e) {
      if (idem) rollbackUsageEvent(req.user.id, idem + ':mp_print');
      throw e;
    }
  });

  // --- Оригиналы этикеток площадок: загрузка, список, выдача, печать ---
  app.post('/api/marketplaces/documents/upload', { preHandler: requireAuth, bodyLimit: MAX_UPLOAD }, async (req, reply) => {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!['application/pdf', 'image/png'].includes(mime)) {
      return reply.code(415).send({ error: 'Загрузите оригинал этикетки в PDF или PNG' });
    }
    const marketplace = String(req.query.marketplace || '');
    if (!isMarketplace(marketplace)) return reply.code(400).send({ error: 'Выберите площадку' });
    const kind = req.query.kind === 'product' ? 'product' : 'shipping';
    const profileId = String(req.query.profileId || '');
    if (profileId) {
      const p = profileById(profileId);
      if (!p || p.marketplace !== marketplace) return reply.code(400).send({ error: 'Профиль не соответствует площадке' });
    }
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!data.length) return reply.code(400).send({ error: 'Пустой файл' });
    if (data.length > MAX_UPLOAD) return reply.code(413).send({ error: 'Файл больше 20 МБ' });
    const isPdf = data.subarray(0, 5).toString('latin1') === '%PDF-';
    const isPng = data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
    if ((mime === 'application/pdf' && !isPdf) || (mime === 'image/png' && !isPng)) {
      return reply.code(400).send({ error: 'Содержимое не похоже на ' + (mime === 'application/pdf' ? 'PDF' : 'PNG') + ' — файл повреждён или это другой формат' });
    }
    const count = db.prepare('SELECT COUNT(*) n FROM marketplace_documents WHERE user_id=?').get(req.user.id).n;
    if (count >= MAX_DOCS_PER_USER) return reply.code(409).send({ error: 'Достигнут лимит 300 документов — удалите старые' });
    const sha256 = createHash('sha256').update(data).digest('hex');
    const filename = safeFilename(req.query.filename);
    const info = db.prepare('INSERT INTO marketplace_documents (user_id, marketplace, kind, profile_id, filename, mime, size, sha256) VALUES (?,?,?,?,?,?,?,?)')
      .run(req.user.id, marketplace, kind, profileId, filename, mime, data.length, sha256);
    const id = Number(info.lastInsertRowid);
    try {
      writeFileSync(docPath(id), data);
    } catch (e) {
      db.prepare('DELETE FROM marketplace_documents WHERE id=?').run(id);
      return reply.code(500).send({ error: 'Не удалось сохранить файл' });
    }
    logActivity(req.user, 'marketplaces_upload', 'Загружена этикетка площадки', {
      total: 1, ok: 1, meta: { marketplace, kind, size: data.length }
    });
    return reply.code(201).send({ id, sha256, size: data.length, mime, filename, marketplace, kind, profileId });
  });

  app.get('/api/marketplaces/documents', { preHandler: requireAuth }, async (req) => ({
    documents: db.prepare('SELECT * FROM marketplace_documents WHERE user_id=? ORDER BY id DESC LIMIT 300').all(req.user.id)
      .map((r) => ({ id: r.id, marketplace: r.marketplace, kind: r.kind, profileId: r.profile_id, filename: r.filename, mime: r.mime, size: r.size, sha256: r.sha256, createdAt: r.created_at }))
  }));

  function ownDocument(req, reply) {
    const row = db.prepare('SELECT * FROM marketplace_documents WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
    if (!row) { reply.code(404).send({ error: 'Документ не найден' }); return null; }
    if (!existsSync(docPath(row.id))) { reply.code(410).send({ error: 'Файл документа отсутствует на диске' }); return null; }
    return row;
  }

  app.get('/api/marketplaces/documents/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownDocument(req, reply);
    if (!row) return reply;
    const data = readFileSync(docPath(row.id));
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    reply.header('Content-Type', row.mime);
    reply.header('Content-Disposition', disposition + '; filename="' + safeFilename(row.filename) + '"');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(data);
  });

  // Печать оригинала: PDF отдаётся как есть (браузер печатает в фактическом
  // размере), PNG размещается на странице точного размера выбранного профиля.
  app.post('/api/marketplaces/documents/:id/print', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownDocument(req, reply);
    if (!row) return reply;
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      consumeOperations(req.user, 1, { idemKey: idem ? idem + ':mp_doc_print' : '', context: 'marketplaces_doc_print' });
    } catch (e) { return usageErrorReply(reply, e); }
    const data = readFileSync(docPath(row.id));
    if (row.mime === 'application/pdf') {
      logActivity(req.user, 'marketplaces_doc_print', 'Печать оригинала PDF', { total: 1, ok: 1, meta: { marketplace: row.marketplace, documentId: row.id } });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="' + safeFilename(row.filename) + '"');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(data);
    }
    const profile = profileById(req.body?.profileId || row.profile_id);
    if (!profile) {
      if (idem) rollbackUsageEvent(req.user.id, idem + ':mp_doc_print');
      return reply.code(400).send({ error: 'Для PNG выберите профиль с размером этикетки' });
    }
    const b64 = data.toString('base64');
    const label = '<div class="label" style="width:' + profile.widthMm + 'mm;height:' + profile.heightMm + 'mm">'
      + '<img alt="" style="display:block;width:100%;height:100%;object-fit:contain" src="data:image/png;base64,' + b64 + '"></div>';
    logActivity(req.user, 'marketplaces_doc_print', 'Печать оригинала PNG', { total: 1, ok: 1, meta: { marketplace: row.marketplace, documentId: row.id, profileId: profile.id } });
    return reply.type('text/html; charset=utf-8').send(printDocument({
      labels: [label], widthMm: profile.widthMm, heightMm: profile.heightMm,
      title: 'Печать оригинала · ' + profile.name
    }));
  });

  app.delete('/api/marketplaces/documents/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownDocument(req, reply);
    if (!row) return reply;
    db.prepare('DELETE FROM marketplace_documents WHERE id=?').run(row.id);
    try { unlinkSync(docPath(row.id)); } catch { /* файл уже удалён */ }
    return { ok: true };
  });
}
