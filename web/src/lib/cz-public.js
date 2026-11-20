/**
 * Публичная проверка кода маркировки «Честного ЗНАКа» прямо из браузера клиента.
 *
 * Почему из браузера: серверы ЦРПТ отдают HTTP 451 на запросы с дата-центровых IP,
 * а с обычного IP пользователя ответ приходит нормально. Запрос отправляем простой
 * формой (application/x-www-form-urlencoded) — тогда браузер не делает CORS-preflight,
 * а API ЧЗ разрешает наш Origin (access-control-allow-origin).
 *
 * Ответ содержит полную карточку: название, вид, объём, состав, производитель,
 * даты, статус кода и результат криптопроверки.
 */

const ENDPOINT = 'https://mobile.api.crpt.ru/mobile/check';
const CACHE_KEY = 'cq_cz_public_cards_v1';
const CACHE_TTL_MS = 30 * 60 * 1000;

const STATUS_RU = {
  INTRODUCED: 'В обороте',
  EMITTED: 'Эмитирован',
  APPLIED: 'Нанесён',
  RETIRED: 'Выбыл из оборота',
  WRITTEN_OFF: 'Списан',
  DISAGGREGATION: 'Отсоединён',
  RESERVED: 'Зарезервирован',
  CHECKED: 'Проверен'
};

function readCache() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeCache(code, card) {
  try {
    const cache = readCache();
    cache[code] = { at: Date.now(), card };
    const entries = Object.entries(cache)
      .filter(([, v]) => Date.now() - (v.at || 0) < CACHE_TTL_MS)
      .slice(-200);
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* переполнение хранилища — не критично */
  }
}

/** ЧЗ принимает машинный код с идентификаторами: (01)0463…(21)5ZsWrd → 010463…215ZsWrd */
export function normalizeCodeForCz(code) {
  const source = String(code || '').trim();
  if (/\(\d{2,4}\)/.test(source)) {
    // человекочитаемый вид: собираем «AI + значение» без скобок
    let out = '';
    for (const m of source.matchAll(/\((\d{2,4})\)([^()]*)/g)) {
      out += m[1] + String(m[2] || '').replace(/[\s\u001d\u00e8]/g, '');
    }
    if (out) return out;
  }
  return source.replace(/[\s\u001d\u00e8()]/g, '');
}

function fmtDate(value) {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function pickCategoryData(raw) {
  const category = String(raw?.category || '');
  const byCategory = category && raw[`${category}Data`];
  if (byCategory && typeof byCategory === 'object') return byCategory;
  for (const key of Object.keys(raw || {})) {
    if (/Data$/.test(key) && raw[key] && typeof raw[key] === 'object') return raw[key];
  }
  return {};
}

/** Достаёт карточку товара по коду через публичный мобильный API ЧЗ. */
export async function fetchCodeCard(code) {
  const trimmed = normalizeCodeForCz(code);
  if (!trimmed) throw new Error('Пустой код');

  const cache = readCache();
  const cached = cache[trimmed];
  if (cached && Date.now() - (cached.at || 0) < CACHE_TTL_MS && cached.card) {
    return { ...cached.card, cached: true };
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `code=${encodeURIComponent(trimmed)}`,
    credentials: 'omit',
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`ЧЗ вернул HTTP ${res.status}`);
  const raw = await res.json().catch(() => null);
  if (!raw || typeof raw !== 'object') throw new Error('ЧЗ вернул не JSON');

  if (!raw.codeFounded) {
    return { found: false, gtin: '', serial: '', message: 'Код не найден в «Честном ЗНАКе»' };
  }

  const data = pickCategoryData(raw);
  const prop = data.productProperty || {};
  const catalog = Array.isArray(raw.catalogData) ? raw.catalogData[0] : null;
  const resolve = raw.codeResolveData || {};
  const ais = resolve.ais || {};
  const statusRaw = String(data.status || data.outerStatus || resolve.status || raw.status || '').toUpperCase();
  const composition = Array.isArray(prop.productComposition)
    ? prop.productComposition.map((x) => x?.value).filter(Boolean).join(', ')
    : '';

  const card = {
    found: true,
    sourceLabel: 'Честный ЗНАК (публичная проверка)',
    name: raw.productName || data.productName || catalog?.good_name || '',
    brand: data.brand || catalog?.brand_name || '',
    category: data.productKind || '',
    quantity: prop.nominalQuantity || '',
    producer: data.manufacturerName || catalog?.producer_name || raw.producerName || '',
    producerInn: data.manufacturerInn || raw.ownerInn || resolve.ownerInn || '',
    composition,
    productKind: data.productKind || '',
    model: '',
    size: prop.nominalQuantity || '',
    color: '',
    material: '',
    structure: composition,
    productionDate: fmtDate(data.producedDate),
    emissionDate: fmtDate(data.emissionDate),
    expirationDate: fmtDate(data.expirationDate),
    serviceLife: data.serviceLife || '',
    serviceLifeCharacteristic: data.serviceLifeCharacteristic || '',
    status: STATUS_RU[statusRaw] || statusRaw,
    statusRaw,
    crypto: {
      checked: Boolean(raw.checkResult),
      verified: Boolean(resolve.verified),
      message: resolve.message || raw.warning || ''
    },
    goodUrl: catalog?.good_url || '',
    gtin: resolve.gtin || ais.gtin || '',
    serial: resolve.cis || ais.serial || '',
    cached: false
  };
  writeCache(trimmed, card);
  return card;
}

/** Пакетная проверка (по умолчанию до 5 кодов, параллельно). */
export async function fetchCards(codes, limit = 5) {
  const list = (codes || []).slice(0, limit);
  const results = await Promise.allSettled(list.map((code) => fetchCodeCard(code)));
  return results.map((r, i) => ({
    code: list[i],
    card: r.status === 'fulfilled' && r.value?.found ? r.value : null,
    error: r.status === 'rejected' ? String(r.reason?.message || r.reason) : ''
  }));
}
