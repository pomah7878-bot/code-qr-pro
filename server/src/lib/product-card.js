import { db } from '../db.js';
import { getSetting } from '../settings.js';

/**
 * Карточка товара по коду маркировки.
 *
 * Что можно узнать честно:
 *  - из самого кода: GTIN (AI 01), серийник (21), срок годности (17), партия (10);
 *  - из «Честного ЗНАКа» (True API) — название, производитель, статус кода,
 *    но нужен токен ЧЗ и доступ к api.mdlp.crpt.ru (TLS с ГОСТ-шифрами);
 *  - из открытых баз Open Food/Beauty/Products Facts по GTIN — название, бренд,
 *    категория, объём (без ключа, но не по всем российским товарам);
 *  - из своей базы: код находился в загрузках пользователя (job_items) — тогда
 *    показываем, из какого задания он и строку данных.
 */

const UA = 'CODE-QR-PRO/1.0 (+https://code-qr.stockcity.ru)';
const CACHE_DAYS = 30;

const OPEN_FACTS = [
  { id: 'openfoodfacts', label: 'Open Food Facts', base: 'https://world.openfoodfacts.org' },
  { id: 'openbeautyfacts', label: 'Open Beauty Facts', base: 'https://world.openbeautyfacts.org' },
  { id: 'openproductsfacts', label: 'Open Products Facts', base: 'https://world.openproductsfacts.org' }
];

export function gtinFromCode(code) {
  const s = String(code || '').trim();
  const m = s.match(/^01(\d{14})/);
  if (m) return m[1];
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 14) return digits.padStart(14, '0');
  return '';
}

export function normalizeGtin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length <= 14 ? digits.padStart(14, '0') : digits.slice(0, 14);
}

function decodeCode(code) {
  const s = String(code || '');
  const gtin = gtinFromCode(s);
  const serial = (s.match(/^01\d{14}21([^\u001d]{1,32})/) || [])[1] || '';
  const production = (s.match(/(?:^|\u001d)11(\d{6})/) || [])[1] || '';
  const expiry = (s.match(/(?:^|\u001d)17(\d{6})/) || [])[1] || '';
  const batch = (s.match(/(?:^|\u001d)10([^\u001d]{1,24})/) || [])[1] || '';
  const kind = /^01\d{14}21/.test(s) && /^01\d{14}21.{20,}/.test(s) && s.length > 60 ? 'КИЗ (91/92)' : 'GS1 (93)';
  return { gtin, serial, production, expiry, batch, kind, length: s.length };
}

function cacheGet(gtin) {
  if (!gtin) return null;
  return db.prepare(
    "SELECT * FROM product_cards WHERE gtin = ? AND updated_at >= datetime('now', ?)"
  ).get(gtin, `-${CACHE_DAYS} days`) || null;
}

function cachePut(gtin, card) {
  if (!gtin || !card || !card.found) return;
  db.prepare(
    `INSERT INTO product_cards (gtin, name, brand, category, quantity, producer, source, status, raw, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(gtin) DO UPDATE SET
       name = excluded.name, brand = excluded.brand, category = excluded.category,
       quantity = excluded.quantity, producer = excluded.producer, source = excluded.source,
       status = excluded.status, raw = excluded.raw, updated_at = datetime('now')`
  ).run(
    gtin,
    String(card.name || '').slice(0, 300),
    String(card.brand || '').slice(0, 200),
    String(card.category || '').slice(0, 300),
    String(card.quantity || '').slice(0, 80),
    String(card.producer || '').slice(0, 200),
    String(card.source || '').slice(0, 40),
    String(card.status || '').slice(0, 80),
    JSON.stringify(card.raw || {}).slice(0, 4000)
  );
}

async function openFactsLookup(gtin) {
  // GTIN-14 с ведущими нулями не совпадает с EAN-13 в открытых базах — пробуем оба вида.
  const candidates = [...new Set([String(gtin), String(gtin).replace(/^0+/, '')])].filter((v) => v.length >= 8);
  for (const cand of candidates) {
    const tasks = OPEN_FACTS.map(async (src) => {
      const url = `${src.base}/api/v2/product/${encodeURIComponent(cand)}.json?fields=code,product_name,product_name_ru,brands,quantity,categories,generic_name`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      if (data.status !== 1 || !data.product) return null;
      const p = data.product;
      const category = String(p.categories || '').split(',').map((x) => x.trim()).filter(Boolean)[0] || '';
      return {
        found: true,
        source: src.id,
        sourceLabel: src.label,
        name: p.product_name_ru || p.product_name || '',
        brand: p.brands || '',
        category,
        quantity: p.quantity || '',
        producer: '',
        status: '',
        raw: { code: p.code, categories: p.categories, generic_name: p.generic_name }
      };
    });
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.name) return r.value;
    }
  }
  return null;
}

/** ЧЗ True API — если настроен токен. Запрос может падать (TLS ГОСТ), это не критично. */
async function czLookup(code, gtin) {
  const enabled = getSetting('cz_enabled', '0') === '1';
  const token = getSetting('cz_token', '');
  if (!enabled || !token) return { configured: false, card: null, error: '' };
  const apiUrl = (getSetting('cz_api_url', 'https://api.mdlp.crpt.ru') || 'https://api.mdlp.crpt.ru').replace(/\/$/, '');
  try {
    const res = await fetch(`${apiUrl}/api/v3/true-api/cises/info`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify([String(code || '').trim()]),
      signal: AbortSignal.timeout(15000)
    });
    const data = await res.json().catch(() => ({}));
    const item = Array.isArray(data) ? data[0] : data;
    const info = item?.cisInfo;
    if (!info) return { configured: true, card: null, error: item?.errorMessage || (res.ok ? '' : `HTTP ${res.status}`) };
    return {
      configured: true,
      error: '',
      card: {
        found: true,
        source: 'cz',
        sourceLabel: 'Честный ЗНАК',
        name: info.productName || '',
        brand: info.brand || '',
        category: info.productGroup || '',
        quantity: '',
        producer: info.producerName || info.ownerName || '',
        status: info.status || '',
        raw: { emissionDate: info.emissionDate, gtin: info.gtin || gtin, owner: info.ownerName }
      }
    };
  } catch (e) {
    return { configured: true, card: null, error: String(e?.message || e) };
  }
}

function historyLookup(userId, gtin, code) {
  if (!userId || !gtin) return null;
  try {
    const row = db.prepare(
      `SELECT ji.raw, ji.gtin, ji.serial, gj.id AS job_id, gj.name AS job_name, gj.created_at
       FROM job_items ji JOIN generation_jobs gj ON gj.id = ji.job_id
       WHERE gj.user_id = ? AND (ji.gtin = ? OR ji.normalized = ?)
       ORDER BY ji.id DESC LIMIT 1`
    ).get(userId, gtin, String(code || '').trim());
    if (!row) return null;
    return {
      jobId: row.job_id,
      jobName: row.job_name || `Задание #${row.job_id}`,
      createdAt: row.created_at,
      raw: String(row.raw || '').slice(0, 300)
    };
  } catch {
    return null;
  }
}

/** Возвращает карточку товара + разбор кода + историю нахождений. */
export async function productCard({ userId = null, code = '', gtin = '' } = {}) {
  const decoded = decodeCode(code);
  const g = normalizeGtin(gtin) || decoded.gtin;
  const history = historyLookup(userId, g, code);

  let card = g ? cacheGet(g) : null;
  if (card && card.name) {
    card = {
      found: true,
      source: card.source,
      sourceLabel: card.source === 'cz' ? 'Честный ЗНАК' : (OPEN_FACTS.find((s) => s.id === card.source)?.label || 'Открытые данные'),
      name: card.name,
      brand: card.brand,
      category: card.category,
      quantity: card.quantity,
      producer: card.producer,
      status: card.status,
      cached: true
    };
    return { ok: true, gtin: g, decoded, history, card, cz: { configured: getSetting('cz_enabled', '0') === '1' && Boolean(getSetting('cz_token', '')) } };
  }

  const cz = await czLookup(code, g);
  if (cz.card) {
    cachePut(g, cz.card);
    return { ok: true, gtin: g, decoded, history, card: { ...cz.card, cached: false }, cz: { configured: true } };
  }

  let found = null;
  if (g) {
    try { found = await openFactsLookup(g); } catch { found = null; }
    if (found) cachePut(g, found);
  }

  return {
    ok: true,
    gtin: g,
    decoded,
    history,
    card: found ? { ...found, cached: false } : null,
    cz: { configured: cz.configured, error: cz.error || '' },
    message: found
      ? ''
      : (cz.error && cz.configured
        ? `ЧЗ недоступен из этой сети (${cz.error}). В открытых базах GTIN ${g} не найден.`
        : `GTIN ${g} не найден в открытых базах — заполните данные товара вручную или загрузите «Справочник товаров».`)
  };
}
