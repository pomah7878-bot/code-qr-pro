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
const CARD_FIELDS = ['name', 'producer', 'brand', 'category', 'productKind', 'volume', 'composition', 'country', 'productionDate', 'expirationDate', 'serviceLife', 'status', 'crypto'];

const OPEN_FACTS = [
  { id: 'openfoodfacts', label: 'Open Food Facts', base: 'https://world.openfoodfacts.org' },
  { id: 'openbeautyfacts', label: 'Open Beauty Facts', base: 'https://world.openbeautyfacts.org' },
  { id: 'openproductsfacts', label: 'Open Products Facts', base: 'https://world.openproductsfacts.org' }
];

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
  if (value === null || value === undefined || value === '') return '';
  const pad = (x) => String(x).padStart(2, '0');
  // unix timestamp в секундах/миллисекундах (ЧЗ отдаёт producedDate/emissionDate числом)
  const numeric = typeof value === 'number' ? value : (/^\d{10,13}$/.test(String(value).trim()) ? Number(value) : null);
  if (numeric !== null && Number.isFinite(numeric)) {
    const ms = numeric < 1e12 ? numeric * 1000 : numeric;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  }
  const s = String(value).trim();
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

/** Онлайн-проверка одного кода через мобильный API «Честного ЗНАКа» (без токена). */
export async function checkCodeOnline(code) {
  const normalized = normalizeCzCode(code) || String(code || '').trim();
  if (!normalized) throw new Error('Пустой код');
  const { data } = await mobileRequest('status', { code: normalized });
  const status = normalizeStatus(data);
  return {
    found: data?.codeFounded !== false && Boolean(status.found),
    status: status.status || '',
    statusRaw: status.statusRaw || '',
    crypto: status.crypto || '',
    checkResult: data?.checkResult === true,
    verified: Boolean(data?.codeResolveData?.verified),
    name: status.name || '',
    producer: status.producer || '',
    warnings: status.warnings || [],
    source: 'cz-mobile'
  };
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
  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
  const category = categories.length
    ? String(categories[0].cat_name || categories[0].name || '').trim()
    : String(pickAttr(attrs, 'вид товара', 'вид продукции', 'категория товара') || '').trim();
  const volume = String(
    catalog?.nominal_quantity || catalog?.nominalQuantity || catalog?.good_nominal_quantity ||
    pickAttr(attrs, 'номинальное количество', 'объем', 'объём', 'масса', 'вес', 'количество') || ''
  ).trim();
  const countryRaw = String(pickAttr(attrs, 'страна происхождения', 'страна') || '').trim();
  const country = ({ RU: 'Россия', RUS: 'Россия', BY: 'Беларусь', KZ: 'Казахстан', AM: 'Армения', KG: 'Кыргызстан' })[countryRaw.toUpperCase()] || countryRaw;
  const name = String(catalog?.good_name || data?.productName || pickAttr(attrs, 'полное наименование') || '').trim();
  const serviceLife = String(pickAttr(attrs, 'срок службы', 'срок годности', 'срок использования') || '').trim();
  return {
    found: Boolean(catalog || data?.codeFounded),
    name,
    brand: String(catalog?.brand_name || pickAttr(attrs, 'товарный знак', 'бренд') || '').trim(),
    producer: String(catalog?.producer_name || catalog?.producer_full_name || '').trim(),
    category,
    productKind: String(catalog?.product_kind || data?.productKind || pickAttr(attrs, 'вид товара', 'вид продукции') || '').trim(),
    volume,
    composition: String(pickAttr(attrs, 'состав') || '').trim(),
    country,
    serviceLife,
    productionDate: '',
    expirationDate: '',
    status: '',
    crypto: '',
    images,
    goodUrl: String(catalog?.good_url || '').trim(),
    source: 'cz-catalog',
    sourceLabel: 'Национальный каталог маркированных товаров'
  };
}

const STATUS_RU = {
  introduced: 'В обороте',
  emitted: 'Нанесён',
  applied: 'Нанесён',
  in_stock: 'На складе',
  written_off: 'Списан',
  withdrawn: 'Выбыл',
  disposed: 'Утилизирован',
  not_found: 'Не найден',
  wrong: 'Не проверен',
  invalid: 'Не проверен',
  unknown: 'Нет данных'
};

function statusLabel(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return '';
  // INTRODUCED / IN_STOCK / WRITTEN_OFF → «В обороте» и т.д.
  if (STATUS_RU[key]) return STATUS_RU[key];
  if (key.includes('introduc') || key.includes('circulat')) return 'В обороте';
  if (key.includes('withdraw') || key.includes('writeoff') || key.includes('written')) return 'Выбыл';
  if (key.includes('not_found')) return 'Не найден';
  return String(raw);
}

function normalizeStatus(data) {
  const category = String(data?.category || '');
  const nested = category && data?.[`${category}Data`] && typeof data[`${category}Data`] === 'object'
    ? data[`${category}Data`]
    : {};
  const get = (key) => (nested[key] ?? data[key] ?? '');
  const prop = nested.productProperty && typeof nested.productProperty === 'object' ? nested.productProperty : {};
  const statusRaw = String(get('status') || nested.statusV2 || data?.statusV2 || data?.status || '');
  const checkResult = data?.checkResult === true;
  const verified = Boolean(data?.codeResolveData?.verified);
  let crypto = 'Нет данных';
  if (data?.codeFounded === false) crypto = 'Не проверено';
  else if (checkResult || verified) crypto = 'Проверено';
  else if (data?.codeFounded) crypto = 'Не проверено';
  const composition = Array.isArray(prop.productComposition)
    ? prop.productComposition.map((p) => (p && (p.value || p.name)) || '').filter(Boolean).join(' ')
    : (typeof prop.productComposition === 'string' ? prop.productComposition : '');
  const countryRaw = String(get('country') || get('producerCountry') || get('idProductOrigin') || '').trim();
  const country = ({ RU: 'Россия', RUS: 'Россия', BY: 'Беларусь', KZ: 'Казахстан', AM: 'Армения', KG: 'Кыргызстан' })[countryRaw.toUpperCase()] || countryRaw;
  const warnings = [];
  if (data?.warning) {
    const map = {
      not_verified: 'Криптоподпись кода не подтверждена — проверьте полный код и повторите.',
      not_found: 'Код не найден в «Честном ЗНАКе».',
      wrong: 'Код не прошёл проверку «Честного ЗНАКа».',
      wrong_structure: 'Структура кода отличается от эталонного GS1-формата. Товар и статус найдены, криптоподпись проверена; для надёжности сверьте код сканером или в приложении «Честный ЗНАК».'
    };
    warnings.push(map[String(data.warning)] || 'Источник вернул предупреждение о коде. Товар и статус найдены; проверьте код сканером.');
  }
  if (data?.codeResolveData?.message && !warnings.length) {
    const msg = String(data.codeResolveData.message);
    if (/crypto|invalid/i.test(msg)) warnings.push('Криптографическая часть кода не прошла проверку — статус может быть неактуален.');
    else warnings.push(msg);
  }
  const status = statusLabel(statusRaw);
  const statusFinal = status === 'Не проверен' && checkResult === false && verified ? 'В обороте' : status;
  return {
    found: data?.codeFounded !== false && Boolean(get('productName') || statusRaw || nested),
    name: String(get('productName') || get('goodName') || '').trim(),
    producer: String(get('manufacturerName') || get('producerName') || get('ownerName') || '').trim(),
    brand: String(get('brand') || '').trim(),
    category: String(data?.category || '').trim(),
    productKind: String(get('productKind') || get('goodType') || '').trim(),
    volume: String(get('nominalQuantity') || prop.nominalQuantity || '').trim(),
    composition: String(get('composition') || composition || '').trim(),
    country,
    productionDate: fmtDate(get('producedDate') || get('productionDate')),
    expirationDate: fmtDate(get('expirationDate') || get('expiryDate')),
    serviceLife: String(prop.serviceLife || get('serviceLife') || '').trim(),
    status: statusFinal,
    statusRaw,
    crypto,
    cryptoRaw: { checkResult, verified, status: statusRaw },
    warnings,
    images: [],
    source: 'cz-status',
    sourceLabel: '«Честный ЗНАК» — проверка кода'
  };
}

function cacheKey(gtin) { return String(gtin || '').replace(/\D/g, '').slice(0, 14); }

/** Открытые базы (Open Food/Beauty/Products Facts): карточка по GTIN, если её нет в ЧЗ. */
async function openFactsLookup(gtin) {
  const digits = String(gtin || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const candidates = [...new Set([digits, digits.replace(/^0+/, ''), digits.padStart(14, '0').replace(/^0+/, '')])]
    .filter((g) => g.length >= 8);
  for (const source of OPEN_FACTS) {
    for (const cand of candidates) {
      const started = Date.now();
      try {
        const res = await fetch(`${source.base}/api/v2/product/${cand}.json?fields=product_name,brands,quantity,image_front_url,image_url,ingredients_text,manufacturing_places,countries_tags,categories`, {
          headers: { Accept: 'application/json', 'User-Agent': 'CODE-QR-PRO/1.0 (+https://code-qr.stockcity.ru)' },
          signal: AbortSignal.timeout(10000)
        });
        const latency = Date.now() - started;
        if (!res.ok) {
          recordExternalRequest({ adapter: source.id, ok: false, statusCode: res.status, latencyMs: latency, error: `HTTP ${res.status}`, costUnits: 0 });
          continue;
        }
        const data = await res.json().catch(() => null);
        const product = data?.product;
        if (!product || !(product.product_name || product.brands)) {
          recordExternalRequest({ adapter: source.id, ok: false, statusCode: 200, latencyMs: latency, error: 'product not found', costUnits: 0 });
          continue;
        }
        recordExternalRequest({ adapter: source.id, ok: true, statusCode: 200, latencyMs: latency, costUnits: 1 });
        const countryTag = Array.isArray(product.countries_tags) ? String(product.countries_tags[0] || '') : '';
        const country = ({ 'en:russia': 'Россия', 'en:france': 'Франция', 'en:germany': 'Германия', 'en:italy': 'Италия', 'en:usa': 'США', 'en:united-states': 'США' })[countryTag] || (product.manufacturing_places || '');
        const images = [product.image_front_url, product.image_url].filter((u) => /^https?:\/\//i.test(String(u || '')));
        return {
          found: true,
          name: String(product.product_name || '').trim(),
          brand: String(product.brands || '').split(',')[0].trim(),
          producer: String(product.manufacturing_places || '').trim(),
          category: String(product.categories || '').split(',')[0].trim(),
          productKind: '',
          volume: String(product.quantity || '').trim(),
          composition: String(product.ingredients_text || '').trim().slice(0, 1000),
          country: String(country || '').trim(),
          serviceLife: '',
          productionDate: '',
          expirationDate: '',
          status: '',
          crypto: '',
          images: [...new Set(images)].slice(0, 3),
          goodUrl: `https://world.openfoodfacts.org/product/${cand}`,
          source: source.id,
          sourceLabel: source.label
        };
      } catch (e) {
        recordFailedExternal({ adapter: source.id, error: String(e?.message || e) });
      }
    }
  }
  return null;
}

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
    serviceLife: (() => { try { return String(JSON.parse(row.raw || '{}').serviceLife || ''); } catch { return ''; } })(),
    goodUrl: (() => { try { return String(JSON.parse(row.raw || '{}').goodUrl || ''); } catch { return ''; } })(),
    images: (() => { try { const raw = JSON.parse(row.raw || '{}'); return Array.isArray(raw.images) ? raw.images : []; } catch { return []; } })(),
    source: row.source || '',
    sourceLabel: row.source_label || ({
      'cz-status': '«Честный ЗНАК» — проверка кода',
      'cz-catalog': 'Национальный каталог маркированных товаров',
      'cz-public': '«Честный ЗНАК» (публичная проверка)',
      openfoodfacts: 'Open Food Facts',
      openbeautyfacts: 'Open Beauty Facts',
      openproductsfacts: 'Open Products Facts'
    })[row.source] || '',
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
    card.source || '', card.status || '', JSON.stringify({ images: card.images || [], serviceLife: card.serviceLife || '', goodUrl: card.goodUrl || '' }), sqlNow(now),
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
    composition: '', country: '', productionDate: '', expirationDate: '', serviceLife: '',
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

  // 2б) Если в Нацкаталоге нет — пробуем открытые базы (Open Food/Beauty/Products Facts)
  const needOpenFacts = !card.name || (!card.composition && !card.volume);
  if (needOpenFacts && resolvedGtin && checksAllowed && !errorCached(`off:${resolvedGtin}`)) {
    try {
      const facts = await dedupe(`off:${resolvedGtin}`, () => openFactsLookup(resolvedGtin));
      if (facts) {
        const hadCardSource = card.found && card.source;
        Object.assign(card, mergeCards(card, facts));
        card.found = true;
        card.fetchedAt = new Date().toISOString();
        if (!hadCardSource) {
          card.source = facts.source;
          card.sourceLabel = facts.sourceLabel;
          card.images = facts.images || [];
          card.goodUrl = facts.goodUrl || '';
        } else {
          if (!card.images || !card.images.length) card.images = facts.images || [];
          if (facts.goodUrl) card.goodUrl = facts.goodUrl;
          if (!String(card.sourceLabel || '').includes(facts.sourceLabel)) {
            card.sourceLabel = `${card.sourceLabel || 'Открытые данные'} + ${facts.sourceLabel}`;
          }
        }
        saveCard(card, settingNumber('cache_card_ttl_seconds', 86400));
        sources.push({ id: facts.source, label: facts.sourceLabel, fetchedAt: card.fetchedAt });
        if (actor) {
          consumeChecks(actor, 1, { idemKey: `${idemKey}:off:${resolvedGtin}`, context: 'open-facts', external: true });
          checksConsumed += 1;
        }
      } else {
        cacheError(`off:${resolvedGtin}`, 'not found');
      }
    } catch (e) {
      cacheError(`off:${resolvedGtin}`, e?.message || e);
      errors.push(`Открытые базы: ${String(e?.message || e).slice(0, 120)}`);
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
          // данные конкретного кода из ГИС МТ точнее каталога
          for (const key of ['volume', 'composition', 'productKind', 'brand', 'country', 'serviceLife']) {
            if (status[key]) card[key] = status[key];
          }
          for (const w of (status.warnings || [])) if (!warnings.includes(w)) warnings.push(w);
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

  if (!card.found) {
    warnings.push('Товар не найден в «Честном ЗНАКе» и открытых базах — проверьте код или заполните данные вручную.');
  } else if (!parsed.crypto.present && !parsed.crypto.ai93) {
    warnings.push('Короткий код без криптохвоста — статус в обороте и криптозащита не проверяются.');
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
