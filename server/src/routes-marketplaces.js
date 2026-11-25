// Раздел «Маркетплейсы»: товары, профили этикеток, генерация PDF и печать
// оригиналов площадок. Доступ — все клиенты, лимиты по тарифу (usage.js).
// Размеры и поля берутся из версионируемых профилей (marketplaces.js),
// оригинальные PDF/PNG печатаются без перерисовки содержимого.

import { db } from './db.js';
import { requireAuth } from './routes.js';
import { consumeOperations, consumeExports, UsageError, rollbackUsageEvent } from './lib/usage.js';
import { resolveElements, resolveElementsMany, renderLabelsPdfBuffer, renderMixedLabelsPdfBuffer } from './labels.js';
import PDFDocument from 'pdfkit';
import { labelHtml, printDocument } from './lib/print-html.js';
import { logActivity } from './lib/activity.js';
import { putPdfTicket, getPdfTicket } from './lib/pdf-tickets.js';
import { verifyCodes } from './cz.js';
import { getSetting } from './settings.js';
import { publicUrl } from './lib/public-url.js';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARKETPLACES, isMarketplace, publicProfiles, profileById, PROFILES as PROFILES_IMPORT,
  validateProduct, toDataRow, buildTemplate, PRODUCT_FIELDS, BOX_GUIDES, boxGuide
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
    documentsCount: db.prepare('SELECT COUNT(*) n FROM marketplace_documents WHERE user_id=?').get(req.user.id).n,
    boxesCount: db.prepare('SELECT COUNT(*) n FROM marketplace_boxes WHERE user_id=?').get(req.user.id).n,
    boxGuides: BOX_GUIDES
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

  // --- Короба (грузоместа): разносортная отгрузка на площадки ---
  const BOX_SCHEMES = ['fbs', 'fbo'];
  const BOX_STATUSES = ['packing', 'ready', 'shipped'];
  const MAX_BOXES = 200;
  const MAX_BOX_ITEMS = 200;
  const MAX_BOX_UNITS = 1000;

  function logBoxEvent(boxId, userId, action, detail = '') {
    try {
      db.prepare('INSERT INTO marketplace_box_events (box_id, user_id, action, detail) VALUES (?,?,?,?)')
        .run(boxId, userId, action, String(detail).slice(0, 500));
    } catch { /* история не должна ломать операцию */ }
  }

  // Срок годности: DD.MM.YYYY или YYYY-MM-DD; soon — менее 30 дней (требование WB).
  function expiryInfo(value) {
    const s = String(value || '').trim();
    if (!s) return { status: 'none', daysLeft: null, date: '' };
    let d = null;
    let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + 'T00:00:00');
    if (!d || isNaN(d.getTime())) return { status: 'none', daysLeft: null, date: s };
    const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86400000);
    const status = daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'soon' : 'ok';
    return { status, daysLeft, date: s };
  }

  function normalizeCodes(raw, quantity) {
    const lines = String(raw || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return { codes: '' };
    if (lines.length > 1000) return { error: 'Не больше 1000 кодов на позицию' };
    if (lines.some((c) => c.length > 200)) return { error: 'Слишком длинный код (до 200 символов)' };
    if (new Set(lines).size !== lines.length) return { error: 'Коды единиц должны быть уникальными — есть дубли' };
    if (lines.length !== quantity) return { error: 'Кодов ' + lines.length + ', а количество ' + quantity + ' — запишите код каждой единицы' };
    return { codes: lines.join('\n') };
  }

  function shippedGuard(row, reply) {
    if (row.status === 'shipped') {
      reply.code(409).send({ error: 'Короб отгружен — состав заблокирован. Верните статус «Собирается», если нужно исправить.' });
      return true;
    }
    return false;
  }

  function markStale(boxId, userId, action, detail) {
    db.prepare("UPDATE marketplace_boxes SET labels_stale=1, updated_at=datetime('now') WHERE id=?").run(boxId);
    logBoxEvent(boxId, userId, action, detail);
  }

  function ownBox(req, reply) {
    const row = db.prepare('SELECT * FROM marketplace_boxes WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
    if (!row) { reply.code(404).send({ error: 'Короб не найден' }); return null; }
    return row;
  }

  function boxView(r) {
    const agg = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(quantity),0) units FROM marketplace_box_items WHERE box_id=?').get(r.id);
    return {
      id: r.id, marketplace: r.marketplace, scheme: r.scheme, name: r.name,
      status: r.status, documentId: r.document_id, labelsStale: Boolean(r.labels_stale),
      itemsCount: agg.n, units: agg.units, createdAt: r.created_at, updatedAt: r.updated_at
    };
  }

  function itemView(r) {
    return { id: r.id, productId: r.product_id, name: r.name, barcode: r.barcode, gtin: r.gtin, sku: r.sku, profileId: r.profile_id, quantity: r.quantity, codes: r.codes || '', codesCount: r.codes ? r.codes.split('\n').filter(Boolean).length : 0 };
  }

  function defaultProductProfile(marketplace) {
    return PROFILES_IMPORT.find((p) => p.marketplace === marketplace && p.kind === 'product' && !p.requiresCheck) || null;
  }

  app.get('/api/marketplaces/boxes', { preHandler: requireAuth }, async (req) => ({
    boxes: db.prepare('SELECT * FROM marketplace_boxes WHERE user_id=? ORDER BY id DESC LIMIT 200').all(req.user.id).map(boxView)
  }));

  app.post('/api/marketplaces/boxes', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body || {};
    if (!isMarketplace(body.marketplace)) return reply.code(400).send({ error: 'Выберите площадку' });
    const scheme = BOX_SCHEMES.includes(body.scheme) ? body.scheme : 'fbs';
    const count = db.prepare('SELECT COUNT(*) n FROM marketplace_boxes WHERE user_id=?').get(req.user.id).n;
    if (count >= MAX_BOXES) return reply.code(409).send({ error: 'Достигнут лимит 200 коробов — удалите старые' });
    const name = String(body.name || '').trim().slice(0, 100) || ('Короб ' + (count + 1));
    const info = db.prepare('INSERT INTO marketplace_boxes (user_id, marketplace, scheme, name) VALUES (?,?,?,?)')
      .run(req.user.id, String(body.marketplace), scheme, name);
    logBoxEvent(info.lastInsertRowid, req.user.id, 'created', name);
    return reply.code(201).send({ box: boxView(db.prepare('SELECT * FROM marketplace_boxes WHERE id=?').get(info.lastInsertRowid)) });
  });

  app.get('/api/marketplaces/boxes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const rows = db.prepare('SELECT * FROM marketplace_box_items WHERE box_id=? ORDER BY id').all(row.id);
    const warnings = [];
    const items = rows.map((r) => {
      const view = itemView(r);
      let expiresAt = '';
      let producedAt = '';
      if (r.product_id) {
        const p = db.prepare('SELECT expires_at, produced_at FROM marketplace_products WHERE id=?').get(r.product_id);
        if (p) { expiresAt = p.expires_at; producedAt = p.produced_at; }
      }
      const expiry = expiryInfo(expiresAt);
      if (expiry.status === 'expired') warnings.push('«' + r.name + '»: срок годности истёк ' + expiry.date + ' — замените товар до отгрузки.');
      if (expiry.status === 'soon') warnings.push('«' + r.name + '»: срок годности истекает через ' + expiry.daysLeft + ' дн. WB принимает товары с остатком не менее 30 дней.');
      return Object.assign(view, { expiresAt, producedAt, expiry });
    });
    if (row.labels_stale) warnings.push('Состав менялся после последней печати — перепечатайте этикетки товаров.');
    let document = null;
    if (row.document_id) {
      const d = db.prepare('SELECT * FROM marketplace_documents WHERE id=? AND user_id=?').get(row.document_id, req.user.id);
      if (d) document = { id: d.id, filename: d.filename, mime: d.mime, size: d.size, marketplace: d.marketplace };
    }
    const events = db.prepare('SELECT action, detail, created_at FROM marketplace_box_events WHERE box_id=? ORDER BY id DESC LIMIT 30').all(row.id)
      .map((e) => ({ action: e.action, detail: e.detail, createdAt: e.created_at }));
    return { box: boxView(row), items, document, guide: boxGuide(row.marketplace, row.scheme), warnings, events };
  });

  app.post('/api/marketplaces/boxes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const body = req.body || {};
    const name = body.name != null ? String(body.name).trim().slice(0, 100) : row.name;
    const scheme = BOX_SCHEMES.includes(body.scheme) ? body.scheme : row.scheme;
    const status = BOX_STATUSES.includes(body.status) ? body.status : row.status;
    if (!name) return reply.code(400).send({ error: 'Укажите название короба' });
    if (row.status === 'shipped' && (name !== row.name || scheme !== row.scheme)) {
      return reply.code(409).send({ error: 'Короб отгружен — название и схема заблокированы. Верните статус «Собирается» для исправлений.' });
    }
    db.prepare("UPDATE marketplace_boxes SET name=?, scheme=?, status=?, updated_at=datetime('now') WHERE id=?").run(name, scheme, status, row.id);
    if (status !== row.status) logBoxEvent(row.id, req.user.id, 'status', row.status + ' → ' + status);
    if (name !== row.name || scheme !== row.scheme) logBoxEvent(row.id, req.user.id, 'updated', name + ' · ' + scheme);
    return { box: boxView(db.prepare('SELECT * FROM marketplace_boxes WHERE id=?').get(row.id)) };
  });

  app.delete('/api/marketplaces/boxes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    db.prepare('DELETE FROM marketplace_boxes WHERE id=?').run(row.id);
    return { ok: true };
  });

  app.post('/api/marketplaces/boxes/:id/items', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const body = req.body || {};
    const quantity = Math.max(1, Math.min(1000, Math.round(Number(body.quantity) || 1)));
    let fields = { name: String(body.name || '').trim().slice(0, 200), barcode: String(body.barcode || '').trim().slice(0, 64), gtin: String(body.gtin || '').trim().slice(0, 20), sku: String(body.sku || '').trim().slice(0, 64) };
    let productId = null;
    if (body.productId != null && body.productId !== '') {
      const p = db.prepare('SELECT * FROM marketplace_products WHERE id=? AND user_id=?').get(Number(body.productId), req.user.id);
      if (!p) return reply.code(404).send({ error: 'Товар не найден' });
      productId = p.id;
      fields = { name: p.name, barcode: p.barcode, gtin: p.gtin, sku: p.sku };
    }
    if (!fields.name) return reply.code(400).send({ error: 'Укажите наименование товара' });
    let profileId = String(body.profileId || '');
    if (profileId) {
      const p = profileById(profileId);
      if (!p || p.kind !== 'product' || p.marketplace !== row.marketplace) return reply.code(400).send({ error: 'Профиль не подходит для товарной этикетки этой площадки' });
      if (p.requiresCheck) return reply.code(400).send({ error: 'Профиль «Требует проверки» — выберите подтверждённый' });
    } else {
      const def = defaultProductProfile(row.marketplace);
      profileId = def ? def.id : '';
    }
    if (shippedGuard(row, reply)) return reply;
    const codesResult = normalizeCodes(body.codes, quantity);
    if (codesResult.error) return reply.code(400).send({ error: codesResult.error });
    const count = db.prepare('SELECT COUNT(*) n FROM marketplace_box_items WHERE box_id=?').get(row.id).n;
    if (count >= MAX_BOX_ITEMS) return reply.code(409).send({ error: 'В коробе уже 200 позиций' });
    const info = db.prepare('INSERT INTO marketplace_box_items (box_id, product_id, name, barcode, gtin, sku, profile_id, quantity, codes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(row.id, productId, fields.name, fields.barcode, fields.gtin, fields.sku, profileId, quantity, codesResult.codes);
    markStale(row.id, req.user.id, 'item_added', fields.name + ' × ' + quantity);
    return reply.code(201).send({ item: itemView(db.prepare('SELECT * FROM marketplace_box_items WHERE id=?').get(info.lastInsertRowid)) });
  });

  function ownBoxItem(req, reply, box) {
    const item = db.prepare('SELECT * FROM marketplace_box_items WHERE id=? AND box_id=?').get(Number(req.params.itemId), box.id);
    if (!item) { reply.code(404).send({ error: 'Позиция не найдена' }); return null; }
    return item;
  }

  app.post('/api/marketplaces/boxes/:id/items/:itemId', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const item = ownBoxItem(req, reply, row);
    if (!item) return reply;
    if (shippedGuard(row, reply)) return reply;
    const body = req.body || {};
    const quantity = Math.max(1, Math.min(1000, Math.round(Number(body.quantity) || item.quantity)));
    let profileId = item.profile_id;
    if (body.profileId != null && body.profileId !== '') {
      const p = profileById(body.profileId);
      if (!p || p.kind !== 'product' || p.marketplace !== row.marketplace || p.requiresCheck) {
        return reply.code(400).send({ error: 'Профиль не подходит для товарной этикетки этой площадки' });
      }
      profileId = p.id;
    }
    let codes = item.codes;
    if (body.codes != null) {
      const codesResult = normalizeCodes(body.codes, quantity);
      if (codesResult.error) return reply.code(400).send({ error: codesResult.error });
      codes = codesResult.codes;
    }
    db.prepare('UPDATE marketplace_box_items SET quantity=?, profile_id=?, codes=? WHERE id=?').run(quantity, profileId, codes, item.id);
    markStale(row.id, req.user.id, 'item_updated', item.name + ' × ' + quantity);
    return { item: itemView(db.prepare('SELECT * FROM marketplace_box_items WHERE id=?').get(item.id)) };
  });

  app.delete('/api/marketplaces/boxes/:id/items/:itemId', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const item = ownBoxItem(req, reply, row);
    if (!item) return reply;
    if (shippedGuard(row, reply)) return reply;
    db.prepare('DELETE FROM marketplace_box_items WHERE id=?').run(item.id);
    markStale(row.id, req.user.id, 'item_removed', item.name);
    return { ok: true };
  });

  // Поля позиции для этикетки: снимок + актуальные данные сохранённого товара.
  function itemFields(item) {
    let f = { name: item.name, barcode: item.barcode, gtin: item.gtin, sku: item.sku };
    if (item.product_id) {
      const p = db.prepare('SELECT * FROM marketplace_products WHERE id=?').get(item.product_id);
      if (p) {
        f = {
          name: p.name, manufacturer: p.manufacturer, produced_at: p.produced_at, brand: p.brand,
          sku: p.sku, gtin: p.gtin, barcode: p.barcode, size: p.size, color: p.color,
          composition: p.composition, batch: p.batch, expires_at: p.expires_at, code: p.code
        };
      }
    }
    return f;
  }

  // Один PDF на все вложения короба: каждая этикетка — страница своего размера.
  app.post('/api/marketplaces/boxes/:id/labels/pdf', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const items = db.prepare('SELECT * FROM marketplace_box_items WHERE box_id=? ORDER BY id').all(row.id);
    if (!items.length) return reply.code(400).send({ error: 'Добавьте товары в короб' });
    const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
    if (totalUnits > MAX_BOX_UNITS) return reply.code(400).send({ error: 'В коробе больше 1000 единиц — разбейте на несколько коробов' });
    const groups = [];
    for (const item of items) {
      const profile = profileById(item.profile_id) || defaultProductProfile(row.marketplace);
      if (!profile || profile.requiresCheck) return reply.code(400).send({ error: 'Для позиции «' + item.name + '» не выбран подтверждённый профиль этикетки' });
      const fields = itemFields(item);
      const { problems } = validateProduct(profile, fields);
      if (problems.length) return reply.code(400).send({ error: '«' + item.name + '»: ' + problems[0], problems });
      const dataRow = toDataRow(fields);
      groups.push({ template: buildTemplate(profile), rows: Array.from({ length: item.quantity }, () => dataRow) });
    }
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      consumeOperations(req.user, totalUnits, { idemKey: idem ? idem + ':mp_box_pdf' : '', context: 'marketplaces_box_pdf' });
      consumeExports(req.user, 1, { idemKey: idem ? idem + ':mp_box_pdf_export' : '', context: 'marketplaces_box_pdf_export' });
    } catch (e) {
      if (idem) rollbackUsageEvent(req.user.id, idem + ':mp_box_pdf');
      return usageErrorReply(reply, e);
    }
    try {
      const pdf = await renderMixedLabelsPdfBuffer(groups);
      db.prepare("UPDATE marketplace_boxes SET labels_stale=0, updated_at=datetime('now') WHERE id=?").run(row.id);
      logBoxEvent(row.id, req.user.id, 'labels_printed', totalUnits + ' этикеток');
      logActivity(req.user, 'marketplaces_box_pdf', 'PDF этикеток товаров короба', {
        total: totalUnits, ok: totalUnits, meta: { boxId: row.id, marketplace: row.marketplace, positions: items.length }
      });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'attachment; filename="box-' + row.id + '-labels.pdf"');
      reply.header('Content-Length', String(pdf.length));
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(pdf);
    } catch (e) {
      if (idem) {
        rollbackUsageEvent(req.user.id, idem + ':mp_box_pdf');
        rollbackUsageEvent(req.user.id, idem + ':mp_box_pdf_export');
      }
      throw e;
    }
  });

  // Упаковочный лист А4 — внутренний документ для сверки contents короба.
  app.post('/api/marketplaces/boxes/:id/packing-list', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const items = db.prepare('SELECT * FROM marketplace_box_items WHERE box_id=? ORDER BY id').all(row.id);
    if (!items.length) return reply.code(400).send({ error: 'Добавьте товары в короб' });
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      consumeExports(req.user, 1, { idemKey: idem ? idem + ':mp_box_list' : '', context: 'marketplaces_box_list' });
    } catch (e) { return usageErrorReply(reply, e); }
    try {
      const marketTitle = (MARKETPLACES.find((m) => m.id === row.marketplace) || {}).title || row.marketplace;
      const guide = boxGuide(row.marketplace, row.scheme);
      const doc = new PDFDocument({ size: 'A4', margin: 30 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      const ended = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });
      try { doc.registerFont('MP', join(__dirname, '..', 'assets', 'LiberationSans-Regular.ttf')); doc.font('MP'); } catch { /* fallback */ }
      const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
      const cols = [30, 55, 265, 350, 470];
      const header = () => {
        doc.fontSize(8).fillColor('#666666');
        doc.text('№', cols[0], doc.y, { width: 20 });
        const y = doc.y - 10;
        doc.text('Наименование', cols[1], y, { width: 200 });
        doc.text('Артикул', cols[2], y, { width: 80 });
        doc.text('Штрихкод', cols[3], y, { width: 110 });
        doc.text('Кол-во', cols[4], y, { width: 60 });
        doc.moveDown(0.4);
        doc.moveTo(30, doc.y).lineTo(565, doc.y).lineWidth(0.5).strokeColor('#999999').stroke();
        doc.moveDown(0.3);
      };
      doc.fontSize(16).fillColor('#000000').text('Упаковочный лист · ' + row.name);
      doc.fontSize(9).fillColor('#666666').text('Внутренний документ для сверки вложений — не является этикеткой площадки.');
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#000000');
      doc.text('Площадка: ' + marketTitle + ' · Схема: ' + row.scheme.toUpperCase() + ' · Дата: ' + new Date().toISOString().slice(0, 10));
      doc.text('Статус: ' + ({ packing: 'собирается', ready: 'готов к отгрузке', shipped: 'отгружен' }[row.status] || row.status));
      if (guide) doc.fontSize(8).fillColor('#666666').text('Этикетка короба: ' + guide.boxLabel);
      doc.moveDown(0.8);
      header();
      doc.fontSize(9).fillColor('#000000');
      items.forEach((item, i) => {
        if (doc.y > 760) { doc.addPage(); header(); doc.fontSize(9).fillColor('#000000'); }
        const y = doc.y;
        doc.text(String(i + 1), cols[0], y, { width: 20 });
        doc.text(item.name, cols[1], y, { width: 200 });
        doc.text(item.sku || '—', cols[2], y, { width: 80 });
        doc.text(item.barcode || '—', cols[3], y, { width: 110 });
        doc.text(String(item.quantity), cols[4], y, { width: 60 });
        doc.y = y + Math.max(14, doc.heightOfString(item.name, { width: 200 }) + 4);
        doc.x = 30;
      });
      doc.moveDown(0.8);
      doc.fontSize(10).text('Итого: ' + items.length + ' наименований, ' + totalUnits + ' единиц');
      doc.end();
      await ended;
      const pdf = Buffer.concat(chunks);
      logActivity(req.user, 'marketplaces_box_list', 'Упаковочный лист короба', { total: 1, ok: 1, meta: { boxId: row.id } });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'attachment; filename="box-' + row.id + '-packing-list.pdf"');
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(pdf);
    } catch (e) {
      if (idem) rollbackUsageEvent(req.user.id, idem + ':mp_box_list');
      throw e;
    }
  });

  // Пик-лист на сборку короба: задание комплектовщику с чекбоксами и подписями.
  app.post('/api/marketplaces/boxes/:id/picking-list', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const items = db.prepare('SELECT * FROM marketplace_box_items WHERE box_id=? ORDER BY id').all(row.id);
    if (!items.length) return reply.code(400).send({ error: 'Добавьте товары в короб' });
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      consumeExports(req.user, 1, { idemKey: idem ? idem + ':mp_pick_list' : '', context: 'marketplaces_pick_list' });
    } catch (e) { return usageErrorReply(reply, e); }
    try {
      const marketTitle = (MARKETPLACES.find((m) => m.id === row.marketplace) || {}).title || row.marketplace;
      const doc = new PDFDocument({ size: 'A4', margin: 30 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      const ended = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });
      try { doc.registerFont('MP', join(__dirname, '..', 'assets', 'LiberationSans-Regular.ttf')); doc.font('MP'); } catch { /* fallback */ }
      const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
      const cols = [30, 50, 235, 310, 430, 495];
      const header = () => {
        const y = doc.y;
        doc.fontSize(8).fillColor('#666666');
        doc.text('№', cols[0], y, { width: 18 });
        doc.text('Наименование', cols[1], y, { width: 180 });
        doc.text('Артикул', cols[2], y, { width: 70 });
        doc.text('Штрихкод', cols[3], y, { width: 115 });
        doc.text('Кол-во', cols[4], y, { width: 55 });
        doc.text('✓', cols[5], y, { width: 40 });
        doc.y = y + 12;
        doc.moveTo(30, doc.y).lineTo(565, doc.y).lineWidth(0.5).strokeColor('#999999').stroke();
        doc.moveDown(0.3);
      };
      doc.fontSize(16).fillColor('#000000').text('Пик-лист · сборка короба ' + row.name);
      doc.fontSize(9).fillColor('#666666').text('Задание на сборку: соберите позиции и отметьте ✓ каждую. Штрихкод — для сверки сканером.');
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#000000');
      doc.text('Площадка: ' + marketTitle + ' · Схема: ' + row.scheme.toUpperCase() + ' · Дата: ' + new Date().toISOString().slice(0, 10) + ' · Короб №' + row.id);
      doc.moveDown(0.8);
      header();
      doc.fontSize(9).fillColor('#000000');
      items.forEach((item, i) => {
        if (doc.y > 740) { doc.addPage(); header(); doc.fontSize(9).fillColor('#000000'); }
        const y = doc.y;
        doc.text(String(i + 1), cols[0], y, { width: 18 });
        doc.text(item.name, cols[1], y, { width: 180 });
        doc.text(item.sku || '—', cols[2], y, { width: 70 });
        doc.text(item.barcode || '—', cols[3], y, { width: 115 });
        doc.text(String(item.quantity), cols[4], y, { width: 55 });
        doc.rect(cols[5], y, 10, 10).lineWidth(0.7).strokeColor('#333333').stroke();
        doc.y = y + Math.max(15, doc.heightOfString(item.name, { width: 180 }) + 5);
        doc.x = 30;
      });
      doc.moveDown(0.8);
      doc.fontSize(10).fillColor('#000000').text('Итого: ' + items.length + ' наименований, ' + totalUnits + ' единиц');
      doc.moveDown(1.2);
      doc.fontSize(9).fillColor('#333333');
      doc.text('Собрал: ____________________    Проверил: ____________________    Дата: ____________');
      doc.end();
      await ended;
      const pdf = Buffer.concat(chunks);
      logBoxEvent(row.id, req.user.id, 'picking_printed', totalUnits + ' единиц');
      logActivity(req.user, 'marketplaces_pick_list', 'Пик-лист на сборку короба', { total: 1, ok: 1, meta: { boxId: row.id } });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'attachment; filename="box-' + row.id + '-picking-list.pdf"');
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(pdf);
    } catch (e) {
      if (idem) rollbackUsageEvent(req.user.id, idem + ':mp_pick_list');
      throw e;
    }
  });

  // Привязка загруженного оригинала этикетки короба (или отвязка: documentId=null).
  app.post('/api/marketplaces/boxes/:id/link-document', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const documentId = req.body?.documentId;
    if (documentId == null || documentId === '') {
      db.prepare("UPDATE marketplace_boxes SET document_id=NULL, updated_at=datetime('now') WHERE id=?").run(row.id);
      return { ok: true, documentId: null };
    }
    const d = db.prepare('SELECT * FROM marketplace_documents WHERE id=? AND user_id=?').get(Number(documentId), req.user.id);
    if (!d) return reply.code(404).send({ error: 'Документ не найден' });
    if (d.marketplace !== row.marketplace) return reply.code(400).send({ error: 'Документ другой площадки' });
    db.prepare("UPDATE marketplace_boxes SET document_id=?, updated_at=datetime('now') WHERE id=?").run(d.id, row.id);
    logBoxEvent(row.id, req.user.id, 'document_linked', 'документ №' + d.id);
    return { ok: true, documentId: d.id };
  });

  // Паспорт-наклейка на короб: внутренний DataMatrix со ссылкой на паспорт.
  // Клеится рядом с этикеткой площадки; сканер в разделе открывает короб без вскрытия.
  app.post('/api/marketplaces/boxes/:id/passport-label', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const agg = db.prepare('SELECT COALESCE(SUM(quantity),0) units FROM marketplace_box_items WHERE box_id=?').get(row.id);
    const idem = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    try {
      consumeOperations(req.user, 1, { idemKey: idem ? idem + ':mp_passport' : '', context: 'marketplaces_passport' });
    } catch (e) { return usageErrorReply(reply, e); }
    try {
      const marketTitle = (MARKETPLACES.find((m) => m.id === row.marketplace) || {}).title || row.marketplace;
      const link = publicUrl() + '/app/marketplaces?box=' + row.id;
      const template = {
        name: 'Паспорт короба', widthMm: 58, heightMm: 40, dpi: 203,
        elements: [
          { id: 'ppDm', type: 'datamatrix', field: 'code', x: 2, y: 2, w: 20, h: 20 },
          { id: 'ppName', type: 'field', field: 'name', x: 24, y: 2, w: 32, h: 6, fontSize: 7, align: 'left' },
          { id: 'ppMarket', type: 'field', field: 'market', x: 24, y: 9, w: 32, h: 4, fontSize: 6, align: 'left' },
          { id: 'ppUnits', type: 'field', field: 'units', x: 24, y: 14, w: 32, h: 4, fontSize: 6, align: 'left' },
          { id: 'ppId', type: 'field', field: 'id', x: 24, y: 19, w: 32, h: 4, fontSize: 6, align: 'left' },
          { id: 'ppTitle', type: 'text', text: 'Паспорт короба · CODE QR PRO', x: 2, y: 24, w: 54, h: 4, fontSize: 6.5, align: 'left' },
          { id: 'ppHint', type: 'text', text: 'Сканируйте камерой в разделе «Маркетплейсы» — состав и сроки без вскрытия', x: 2, y: 29, w: 54, h: 8, fontSize: 5.5, align: 'left' }
        ]
      };
      const dataRow = { code: link, name: row.name, market: marketTitle + ' · ' + row.scheme.toUpperCase(), units: agg.units + ' ед.', id: 'Короб №' + row.id };
      const pdf = await renderLabelsPdfBuffer(template, [dataRow], { single: true });
      logBoxEvent(row.id, req.user.id, 'passport_printed', '');
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'attachment; filename="box-' + row.id + '-passport.pdf"');
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(pdf);
    } catch (e) {
      if (idem) rollbackUsageEvent(req.user.id, idem + ':mp_passport');
      throw e;
    }
  });

  // Онлайн-проверка записанных кодов единиц без вскрытия короба.
  app.post('/api/marketplaces/boxes/:id/check-codes', { preHandler: requireAuth }, async (req, reply) => {
    const row = ownBox(req, reply);
    if (!row) return reply;
    const items = db.prepare('SELECT name, codes FROM marketplace_box_items WHERE box_id=?').all(row.id);
    const codes = [];
    for (const it of items) {
      for (const c of String(it.codes || '').split(/\r?\n/)) {
        const t = c.trim();
        if (t) codes.push(t);
      }
    }
    if (!codes.length) return reply.code(400).send({ error: 'В коробе не записаны коды единиц. Добавьте их в составе (по одному на строку) — тогда статусы можно проверять без вскрытия.' });
    if (codes.length > 1000) return reply.code(400).send({ error: 'Слишком много кодов (до 1000)' });
    const globalToken = getSetting('cz_enabled', '0') === '1' ? getSetting('cz_token', '') : '';
    const token = String(req.user?.cz_token || globalToken || '').trim();
    const result = await verifyCodes(codes, 'cz', {
      token,
      apiUrl: getSetting('cz_api_url', 'https://markirovka.crpt.ru'),
      onlineLimit: 50
    });
    logActivity(req.user, 'marketplaces_box_check', 'Проверка кодов короба', {
      total: codes.length, ok: (result.results || []).filter((r) => r.ok).length,
      meta: { boxId: row.id, online: Boolean(result.online) }
    });
    return result;
  });

  // Поиск товара по всем коробам: «в каком коробе лежит X?»
  app.get('/api/marketplaces/box-search', { preHandler: requireAuth }, async (req, reply) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) return reply.code(400).send({ error: 'Введите название, штрихкод или GTIN' });
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const rows = db.prepare(
      'SELECT i.box_id, i.name, i.barcode, i.quantity, b.name AS box_name, b.marketplace, b.scheme, b.status ' +
      'FROM marketplace_box_items i JOIN marketplace_boxes b ON b.id = i.box_id ' +
      'WHERE b.user_id=? AND (i.name LIKE ? OR i.barcode LIKE ? OR i.gtin LIKE ? OR i.codes LIKE ?) ' +
      'ORDER BY i.box_id DESC LIMIT 100'
    ).all(req.user.id, like, like, like, like);
    const byBox = new Map();
    for (const r of rows) {
      if (!byBox.has(r.box_id)) byBox.set(r.box_id, { id: r.box_id, name: r.box_name, marketplace: r.marketplace, scheme: r.scheme, status: r.status, matches: [] });
      byBox.get(r.box_id).matches.push({ name: r.name, barcode: r.barcode, quantity: r.quantity });
    }
    return { boxes: [...byBox.values()].slice(0, 20) };
  });


}
