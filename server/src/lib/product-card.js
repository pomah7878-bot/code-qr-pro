import { db } from '../db.js';
import { getSetting } from '../settings.js';
import { parseDataMatrix } from './datamatrix.js';
import { consumeChecks, checkAvailability, recordExternalRequest, recordFailedExternal } from './usage.js';

/**
 * Расширенная проверка DataMatrix: локальный разбор → каталог по GTIN → статус кода.
 * Внешние API вызываются только на сервере. При ошибке источника лимит не списывается,
 * локальный разбор и карточка из кэша продолжают работать.
 */

const CZ_MOBILE = 'https://mobile.api.crpt.ru/mobile/check';
const CARD_FIELDS = ['name', 'producer', 'brand', 'category', 'productKind', 'volume', 'composition', 'country', 'productionDate', 'expirationDate', 'status', 'crypto'];

const inflight = new Map();
const errorCache = new Map();

const settingNumber = (key, fallback) => {
  const v = Number(getSetting(key, String(fallback)));
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/** Человекочитаемый (01)…(21)…(91)…(92)… → машинный с GS-разделителями. */
export function normalizeCzCode(code) {
  const source = String(code || '').trim();
  if (/\(\d{2,4}\)/.test(source)) {
    const groups = [...source.matchAll(/\((\d{2,4})\)([^()]*)/g)]
      .map((m) => ({ ai: m[1], value: String(m[2] || '').replace(/[\s\u001d\u00e8]/g, '') }))
      .filter((g) => g.value);
    if (groups.length) {
      let out = '';
      for (const group of groups) {
        if (out === '') out = group.ai + group.value;
        else if (group.ai === '21' && !out.includes('\u001d')) out += group.ai + group.value;
        else out += '\u001d' + group.ai + group.value;
      }
      return out;
    }
  }
  return source.replace(/[\s\u00e8()]/g, '');
}

export function gtinFromCode(code) {
  const s = String(code || '').trim();
  const m = s.match(/^01(\d{14})/);
  if (m) return m[1];
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 14) return digits.padStart(14, '0');
  return '';
}

function fmtDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const gs = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (gs) return `${gs[3]}.${gs[2]}.${gs[1]}`;
  return s.slice(0, 10);
}

async function mobileRequest(kind, { code = '', gtin = '' } = {}) {
  const params = new URLSearchParams();
  params.set('code', kind === 'catalog' ? gtin : code);
  if (kind === 'catalog') params.set('codeType', 'ean13');
  const started = Date.now();
  try {
    const res = await fetch(CZ_MOBILE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Origin: 'https://code-qr.stockcity.ru',
        'User-Agent': 'Chestnyznak/4.47.0 (code-qr-pro)'
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15000)
    });
    const latency = Date.now() - started;
    if (!res.ok) {
      recordExternalRequest({ adapter: kind, ok: false, statusCode: res.status, latencyMs: latency, error: `HTTP ${res.status}`, costUnits: 0 });
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => null);
    recordExternalRequest({ adapter: kind, ok: Boolean(data), statusCode: res.status, latencyMs: latency, costUnits: data ? 1 : 0 });
    if (!data || typeof data !== 'object') throw new Error('Пустой ответ источника');
    return { data, latency };
  } catch (e) {
    recordFailedExternal({ adapter: kind, error: String(e?.message || e) });
    throw e;
  }
}

function attrMap(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.attr_name || item.name || item.attribute || item.title || '').trim().toLowerCase();
    const value = String(item.attr_value ?? item.value ?? item.attribute_value ?? '').trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function pickAttr(attrs, ...needles) {
  for (const [key, value] of Object.entries(attrs)) {
    if (needles.some((n) => key.includes(n))) return value;
  }
  return '';
}

function normalizeCatalog(data) {
  const catalog = Array.isArray(data?.catalogData) ? data.catalogData[0] : null;
  const attrs = attrMap(catalog?.good_attrs);
  const images = (Array.isArray(catalog?.good_images) ? catalog.good_images : [])
    .map((img) => (typeof img === 'string' ? img : img?.url || img?.photo_url || ''))
    .filter((url) => /^https?:\/\//i.test(String(url || '')))
    .slice(0, 3);
  return {
    found: Boolean(catalog || data?.codeFounded),
    name: String(catalog?.good_name || data?.productName || '').trim(),
    brand: String(catalog?.brand_name || '').trim(),
    producer: String(catalog?.producer_name || catalog?.producer_full_name || '').trim(),
    category: String(data?.category || '').trim(),
    productKind: String(catalog?.product_kind || data?.productKind || pickAttr(attrs, 'вид продукции', 'вид товара') || '').trim(),
    volume: String(catalog?.nominal_quantity || catalog?.nominalQuantity || pickAttr(attrs, 'объем', 'объём', 'масса', 'вес') || '').trim(),
    composition: String(pickAttr(attrs, 'состав') || '').trim(),
    country: String(pickAttr(attrs, 'страна') || '').trim(),
    productionDate: '',
    expirationDate: '',
    status: '',
    crypto: '',
    images,
    source: 'cz-catalog',
    sourceLabel: 'Национальный каталог маркированных товаров'
  };
}

function normalizeStatus(data) {
  const category = String(data?.category || '');
  const nested = category && data?.[`${category}Data`] && typeof data[`${category}Data`] === 'object'
    ? data[`${category}Data`]
    : {};
  const get = (key) => (nested[key] ?? data[key] ?? '');
  const statusRaw = String(get('status') || data?.statusV2 || data?.status || '');
  const STATUS_RU = {
    introduced: 'В обороте',
    emitted: 'Нанесён',
    applied: 'Нанесён',
    in_stock: 'На складе',
    written_off: 'Списан',
    withdrawn: 'Выбыл',
    disposed: 'Утилизирован',
    not_found: 'Не найден',
    wrong: 'Не проверен'
  };
  const checkResult = data?.checkResult === true;
  const verified = Boolean(data?.codeResolveData?.verified);
  let crypto = 'Нет данных';
  if (data?.codeFounded === false) crypto = 'Не проверено';
  else if (checkResult || verified) crypto = 'Проверено';
  else if (data?.codeFounded) crypto = 'Не проверено';
  return {
    found: data?.codeFounded !== false && Boolean(get('productName') || statusRaw || nested),
    name: String(get('productName') || get('goodName') || '').trim(),
    producer: String(get('manufacturerName') || get('producerName') || get('ownerName') || '').trim(),
    brand: String(get('brand') || '').trim(),
    category: String(data?.category || '').trim(),
    productKind: String(get('productKind') || get('goodType') || '').trim(),
    volume: String(get('nominalQuantity') || '').trim(),
    composition: String(get('composition') || get('productProperty') || '').trim(),
    country: String(get('producerCountry') || get('country') || '').trim(),
    productionDate: fmtDate(get('producedDate') || get('productionDate')),
    expirationDate: fmtDate(get('expirationDate') || get('expiryDate')),
    status: STATUS_RU[statusRaw] || statusRaw,
    statusRaw,
    crypto,
    cryptoRaw: { checkResult, verified, status: statusRaw },
    images: [],
    source: 'cz-status',
    sourceLabel: '«Честный ЗНАК» — проверка кода'
  };
}

function cacheKey(gtin) { return String(gtin || '').replace(/\D/g, '').slice(0, 14); }

function cardFromRow(row) {
  if (!row) return null;
  return {
    found: true,
    gtin: row.gtin,
    name: row.name || '',
    producer: row.producer || '',
    brand: row.brand || '',
    category: row.category || '',
    productKind: row.product_kind || '',
    volume: row.volume || '',
    composition: row.composition || '',
    country: row.country || '',
    productionDate: row.production_date || '',
    expirationDate: row.expiration_date || '',
    status: row.status || '',
    crypto: row.crypto || '',
    images: (() => { try { const raw = JSON.parse(row.raw || '{}'); return Array.isArray(raw.images) ? raw.images : []; } catch { return []; } })(),
    source: row.source || '',
    sourceLabel: row.source_label || '',
    fetchedAt: row.fetched_at || row.updated_at || '',
    cached: true
  };
}

function saveCard(card, ttlSeconds) {
  if (!card?.gtin) return;
  const now = new Date();
  const expires = new Date(now.getTime() + Math.max(60, ttlSeconds) * 1000);
  const sqlNow = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    `INSERT INTO product_cards
      (gtin,name,brand,category,quantity,producer,source,status,raw,updated_at,
       product_kind,volume,composition,country,production_date,expiration_date,crypto,source_label,fetched_at,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(gtin) DO UPDATE SET
       name=excluded.name, brand=excluded.brand, category=excluded.category, quantity=excluded.quantity,
       producer=excluded.producer, source=excluded.source, status=excluded.status, raw=excluded.raw,
       updated_at=excluded.updated_at, product_kind=excluded.product_kind, volume=excluded.volume,
       composition=excluded.composition, country=excluded.country, production_date=excluded.production_date,
       expiration_date=excluded.expiration_date, crypto=excluded.crypto, source_label=excluded.source_label,
       fetched_at=excluded.fetched_at, expires_at=excluded.expires_at`
  ).run(
    card.gtin, card.name || '', card.brand || '', card.category || '', card.volume || '', card.producer || '',
    card.source || '', card.status || '', JSON.stringify({ images: card.images || [] }), sqlNow(now),
    card.productKind || '', card.volume || '', card.composition || '', card.country || '',
    card.productionDate || '', card.expirationDate || '', card.crypto || '', card.sourceLabel || '',
    sqlNow(now), sqlNow(expires)
  );
}

function readCachedCard(gtin) {
  const key = cacheKey(gtin);
  if (!key) return null;
  const row = db.prepare(
    "SELECT * FROM product_cards WHERE gtin=? AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(key);
  return row ? cardFromRow(row) : null;
}

function errorCached(key) {
  const hit = errorCache.get(key);
  if (!hit) return null;
  if (hit.until > Date.now()) return hit.error;
  errorCache.delete(key);
  return null;
}

function cacheError(key, error) {
  const ttl = Math.max(10, settingNumber('cache_error_ttl_seconds', 60));
  errorCache.set(key, { error: String(error || '').slice(0, 300), until: Date.now() + ttl * 1000 });
}

async function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function mergeCards(base, extra) {
  const out = { ...base };
  for (const field of CARD_FIELDS) {
    if ((!out[field] || out[field] === 'Нет данных') && extra[field] && extra[field] !== 'Нет данных') out[field] = extra[field];
  }
  if ((!out.images || !out.images.length) && extra.images?.length) out.images = extra.images;
  return out;
}

function emptyCard(gtin = '') {
  return {
    found: false,
    gtin,
    name: '', producer: '', brand: '', category: '', productKind: '', volume: '',
    composition: '', country: '', productionDate: '', expirationDate: '',
    status: '', crypto: '', images: [],
    source: 'local', sourceLabel: 'Локальный разбор кода', fetchedAt: ''
  };
}

/**
 * Расширенная проверка одного кода.
 * user — объект из req.user (для лимитов), idemKey — ключ идемпотентности запроса.
 */
export async function productCard({ user = null, userId = null, code = '', gtin = '', idemKey = '' } = {}) {
  const source = String(code || '').trim();
  const parsed = parseDataMatrix(source);
  const resolvedGtin = cacheKey(gtin) || parsed.gtin || gtinFromCode(source);
  const card = emptyCard(resolvedGtin);
  card.name = '';
  const warnings = [];
  const errors = [];
  const sources = [{ id: 'local', label: 'Локальный разбор DataMatrix', fetchedAt: new Date().toISOString() }];
  let checksConsumed = 0;
  let checksCached = 0;

  const actor = user || (userId ? db.prepare('SELECT * FROM users WHERE id=?').get(userId) : null);
  const canUseChecks = () => {
    if (!actor) return false;
    try { return checkAvailability(actor, 'check', 1).ok; } catch { return false; }
  };
  const quota = actor ? checkAvailability(actor, 'check', 1) : null;
  const checksAllowed = Boolean(quota?.ok);

  // 1) Карточка из кэша по GTIN — лимит не тратится
  if (resolvedGtin) {
    const cached = readCachedCard(resolvedGtin);
    if (cached) {
      Object.assign(card, mergeCards(card, cached));
      card.found = true;
      card.source = cached.source;
      card.sourceLabel = cached.sourceLabel;
      card.fetchedAt = cached.fetchedAt;
      card.cached = true;
      checksCached += 1;
      sources.push({ id: cached.source || 'cache', label: `${cached.sourceLabel || 'Кэш'} (из кэша)`, fetchedAt: cached.fetchedAt, cached: true });
    }
  }

  // локальные поля из кода (даты, GTIN, серийник, партия)
  if (!card.gtin) card.gtin = resolvedGtin;
  if (!card.productionDate && parsed.productionDate) card.productionDate = parsed.productionDate;
  if (!card.expirationDate && parsed.expiryDate) card.expirationDate = parsed.expiryDate;

  const wantCatalog = Boolean(resolvedGtin) && !card.name;
  const wantStatus = Boolean(parsed.serial) && (parsed.crypto.present || source.length > 40);

  // 2) Каталог по GTIN (кэш выше уже мог закрыть потребность)
  if (wantCatalog) {
    if (!checksAllowed) {
      warnings.push('Расширенные проверки недоступны на вашем тарифе — показан локальный разбор кода.');
    } else if (errorCached(`gtin:${resolvedGtin}`)) {
      warnings.push('Источник каталога временно недоступен — попробуйте позже.');
    } else {
      try {
        const result = await dedupe(`gtin:${resolvedGtin}`, async () => {
          const { data, latency } = await mobileRequest('catalog', { gtin: resolvedGtin });
          return { data, latency };
        });
        const catalog = normalizeCatalog(result.data);
        if (catalog.name) {
          Object.assign(card, mergeCards(card, catalog));
          card.found = true;
          card.source = 'cz-catalog';
          card.sourceLabel = catalog.sourceLabel;
          card.fetchedAt = new Date().toISOString();
          card.images = catalog.images || card.images;
          saveCard(card, settingNumber('cache_card_ttl_seconds', 86400));
          sources.push({ id: 'cz-catalog', label: catalog.sourceLabel, fetchedAt: card.fetchedAt });
          if (actor) {
            consumeChecks(actor, 1, { idemKey: `${idemKey}:catalog:${resolvedGtin}`, context: 'catalog', external: true });
            checksConsumed += 1;
          }
        }
      } catch (e) {
        cacheError(`gtin:${resolvedGtin}`, e?.message || e);
        errors.push(`Каталог: ${String(e?.message || e).slice(0, 120)}`);
        warnings.push('Не удалось получить карточку из каталога — данные по коду доступны, попробуйте повторить.');
      }
    }
  }

  // 3) Статус конкретного кода — отдельный внешний запрос (без длинного кэша)
  if (wantStatus && (card.cached || card.name)) {
    if (!checksAllowed) {
      if (wantStatus) warnings.push('Проверка статуса кода доступна на PRO/BUSINESS (расширенные проверки).');
    } else if (errorCached(`code:${parsed.normalized}`)) {
      warnings.push('Источник статусов временно недоступен — статус не обновлён.');
    } else {
      try {
        const normalized = normalizeCzCode(source) || source;
        const { data } = await dedupe(`code:${normalized}`, () => mobileRequest('status', { code: normalized }));
        const status = normalizeStatus(data);
        if (status.found) {
          Object.assign(card, mergeCards(card, status));
          card.found = true;
          if (!card.productionDate && status.productionDate) card.productionDate = status.productionDate;
          if (!card.expirationDate && status.expirationDate) card.expirationDate = status.expirationDate;
          card.status = status.status || card.status;
          card.crypto = status.crypto || card.crypto;
          if (!card.images?.length && status.images?.length) card.images = status.images;
          card.source = 'cz-status';
          card.sourceLabel = status.sourceLabel;
          card.fetchedAt = new Date().toISOString();
          sources.push({ id: 'cz-status', label: status.sourceLabel, fetchedAt: card.fetchedAt, status: status.statusRaw, crypto: status.crypto });
          if (actor) {
            consumeChecks(actor, 1, { idemKey: `${idemKey}:status:${card.gtin}`, context: 'status', external: true });
            checksConsumed += 1;
          }
        }
      } catch (e) {
        cacheError(`code:${parsed.normalized}`, e?.message || e);
        errors.push(`Статус: ${String(e?.message || e).slice(0, 120)}`);
        warnings.push('Не удалось проверить статус кода — нажмите «Проверить» ещё раз.');
      }
    }
  } else if (wantStatus && !card.cached && !card.name) {
    warnings.push('Статус не проверен: код короткий или неполный.');
  }

  const missing = CARD_FIELDS.filter((field) => !card[field]);
  const finalWarnings = [...new Set(warnings)];
  return {
    ok: true,
    code: {
      input: source.slice(0, 4000),
      normalized: parsed.normalized || '',
      gtin: card.gtin,
      serial: parsed.serial,
      batch: parsed.batch,
      productionDate: parsed.productionDate,
      expiryDate: parsed.expiryDate,
      cryptoType: parsed.cryptoType,
      cryptoPresent: parsed.crypto.present,
      errors: parsed.errors,
      warnings: parsed.warnings,
      structureOk: parsed.ok,
      checks: parsed.checks
    },
    card: {
      ...card,
      found: Boolean(card.found && (card.name || card.status)),
      missing,
      warnings: finalWarnings,
      errors,
      sources,
      checks: { consumed: checksConsumed, cached: checksCached, left: actor ? Math.max(0, (quota?.left ?? 0)) : null }
    },
    local: parsed,
    source: card.source,
    updatedAt: card.fetchedAt
  };
}
