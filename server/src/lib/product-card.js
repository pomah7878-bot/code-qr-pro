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
const CZ_STATUS_RU = {
  EMITTED: 'Эмитирован',
  APPLIED: 'Нанесён',
  INTRODUCED: 'В обороте',
  RETIRED: 'Выбыл из оборота',
  WRITTEN_OFF: 'Списан',
  DISAGGREGATION: 'Отсоединён',
  RESERVED: 'Зарезервирован'
};

/**
 * Публичная проверка кода через мобильный API ЧЗ (без токена).
 * Эндпоинт недокументированный, мобильное приложение ходит так:
 *   GET https://mobile.api.crpt.ru/mobile/check?code=...&codeType=datamatrix
 * С части сетей/дата-центров отдаёт 451 — тогда просто идём дальше по источникам.
 */
async function publicMobileCheck(code) {
  if (!code) return null;
  try {
    const normalized = normalizeCzCode(code);
    const url = `https://mobile.api.crpt.ru/mobile/check?code=${encodeURIComponent(normalized)}&codeType=datamatrix`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Chestnyznak/4.47.0 (chestnyznak-mcp)'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return null;
    const nested = raw.category && raw[`${raw.category}Data`] && typeof raw[`${raw.category}Data`] === 'object'
      ? raw[`${raw.category}Data`]
      : {};
    const get = (key) => (nested[key] ?? raw[key] ?? '');
    const statusRaw = String(get('status') || '');
    const card = {
      found: Boolean(raw.codeFounded ?? true),
      source: 'cz-public',
      sourceLabel: 'Честный ЗНАК (публичная проверка)',
      name: String(get('productName') || ''),
      brand: String(get('brand') || ''),
      category: String(raw.category || get('productKind') || ''),
      quantity: String(get('nominalQuantity') || ''),
      producer: String(get('producerName') || ''),
      status: CZ_STATUS_RU[statusRaw] || statusRaw,
      raw: { status: statusRaw, checkResult: raw.checkResult, ownerName: get('ownerName'), ownerInn: get('ownerInn') }
    };
    return card.name || card.producer || card.status ? card : null;
  } catch {
    return null;
  }
}

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

/** Человекочитаемый код (01)…(21)…(91)…(92)… → машинный 01…21…<GS>91…<GS>92… (как ждёт ЧЗ). */
export function normalizeCzCode(code) {
  const source = String(code || '').trim();
  if (/\(\d{2,4}\)/.test(source)) {
    // человекочитаемый вид: собираем машинный код; GS-разделитель нужен перед (91)/(92) и прочими AI
    const groups = [...source.matchAll(/\((\d{2,4})\)([^()]*)/g)]
      .map((m) => ({ ai: m[1], value: String(m[2] || '').replace(/[\s\u001d\u00e8]/g, '') }))
      .filter((g) => g.value);
    if (groups.length) {
      let out = '';
      for (const group of groups) {
        const head = out === '';
        if (head) out = group.ai + group.value;
        else if (group.ai === '21' && !out.includes('\u001d')) out += group.ai + group.value;
        else out += '\u001d' + group.ai + group.value;
      }
      return out;
    }
  }
  // машинный вид: сохраняем GS-разделители, убираем только пробелы и FNC1
  return source.replace(/[\s\u00e8()]/g, '');
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

/** Базовый URL True API. В документации это markirovka.crpt.ru (обычный TLS). */
function czBase() {
  const raw = String(getSetting('cz_api_url', 'https://markirovka.crpt.ru/api/v3/true-api') || '').trim()
    .replace(/\/+$/, '');
  if (!raw) return 'https://markirovka.crpt.ru/api/v3/true-api';
  // Раньше в настройках мог быть api.mdlp.crpt.ru (ГОСТ-TLS, legacy) — переводим на рабочий хост.
  if (/api\.mdlp\.crpt\.ru/.test(raw) || !/\/api\/v\d\//.test(raw)) return 'https://markirovka.crpt.ru/api/v3/true-api';
  return raw;
}

/** Токен ЧЗ: сначала личный токен пользователя, затем глобальный из настроек. */
function resolveCzToken(userToken) {
  const personal = String(userToken || '').trim();
  if (personal) return { token: personal, source: 'user' };
  const globalToken = String(getSetting('cz_token', '') || '').trim();
  const enabled = getSetting('cz_enabled', '0') === '1';
  if (enabled && globalToken) return { token: globalToken, source: 'global' };
  return { token: '', source: '' };
}

function mapCzProduct(card) {
  return {
    name: card.name || card.productName || '',
    brand: card.brand || '',
    category: card.productGroup || card.productKind || '',
    quantity: card.nominalQuantity || '',
    producer: card.producerName || card.ownerName || '',
    model: card.model || '',
    size: card.size || '',
    color: card.color || '',
    material: card.material || '',
    structure: card.structure || '',
    age: card.age || '',
    productKind: card.productKind || '',
    expirationDate: card.expirationDate || '',
    gtin: card.gtin || ''
  };
}

/** ЧЗ True API: сведения по коду (статус, криптопроверка) + карточка товара по GTIN. */
async function czLookup(code, gtin, userToken = '') {
  const { token, source } = resolveCzToken(userToken);
  if (!token) return { configured: false, card: null, error: '', source: '' };
  const base = czBase();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA };
  let card = null;
  let error = '';

  if (code) {
    try {
      const res = await fetch(`${base}/cises/info`, {
        method: 'POST', headers: auth, body: JSON.stringify([normalizeCzCode(code)]), signal: AbortSignal.timeout(15000)
      });
      const data = await res.json().catch(() => ({}));
      const item = Array.isArray(data) ? data[0] : data;
      const info = item?.cisInfo;
      if (info) {
        card = {
          ...mapCzProduct(info),
          source: 'cz',
          sourceLabel: 'Честный ЗНАК',
          status: info.status || '',
          raw: { emissionDate: info.emissionDate, owner: info.ownerName, cis: String(code).slice(0, 120) }
        };
      } else if (!res.ok) {
        error = item?.error_message || data?.error_message || `ЧЗ вернул HTTP ${res.status}`;
      }
    } catch (e) {
      error = String(e?.message || e);
    }
  }

  if ((!card || !card.name) && gtin) {
    try {
      const res = await fetch(`${base.replace(/\/api\/v3\/true-api$/, '/api/v4/true-api')}/product/info`, {
        method: 'POST', headers: auth, body: JSON.stringify({ gtins: [gtin] }), signal: AbortSignal.timeout(15000)
      });
      const data = await res.json().catch(() => ({}));
      const item = data?.results?.[0];
      if (item) {
        card = { ...(card || {}), ...mapCzProduct(item), source: 'cz', sourceLabel: 'Честный ЗНАК', status: card?.status || '', raw: card?.raw || {} };
      } else if (!res.ok && !error) {
        error = data?.error_message || `ЧЗ вернул HTTP ${res.status}`;
      }
    } catch (e) {
      if (!error) error = String(e?.message || e);
    }
  }

  return { configured: true, card, error, source };
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
export async function productCard({ userId = null, code = '', gtin = '', czToken = '' } = {}) {
  const decoded = decodeCode(code);
  const g = normalizeGtin(gtin) || decoded.gtin;
  const history = historyLookup(userId, g, code);
  const personalToken = String(czToken || '').trim();
  const hasToken = Boolean(personalToken) || (getSetting('cz_enabled', '0') === '1' && Boolean(getSetting('cz_token', '')));

  const cz = await czLookup(code, g, personalToken);
  if (cz.card && cz.card.name) {
    cachePut(g, cz.card);
    return {
      ok: true, gtin: g, decoded, history,
      card: { found: true, ...cz.card, cached: false },
      cz: { configured: true, source: cz.source, error: '' }
    };
  }

  let card = g ? cacheGet(g) : null;
  if (card && card.name) {
    return {
      ok: true, gtin: g, decoded, history,
      card: {
        found: true,
        source: card.source,
        sourceLabel: card.source === 'cz' ? 'Честный ЗНАК' : card.source === 'cz-public' ? 'Честный ЗНАК (публичная проверка)' : (OPEN_FACTS.find((s) => s.id === card.source)?.label || 'Открытые данные'),
        name: card.name,
        brand: card.brand,
        category: card.category,
        quantity: card.quantity,
        producer: card.producer,
        status: card.status,
        cached: true
      },
      cz: { configured: hasToken, error: cz.error || '' }
    };
  }

  let found = null;
  // Публичная проверка ЧЗ (без токена) — недокументированный мобильный API
  try { found = await publicMobileCheck(code); } catch { found = null; }
  if (found && g && !found.name) found = null;
  // Открытые базы по GTIN — если ЧЗ по коду ничего не дал
  if (!found && g) {
    try { found = await openFactsLookup(g); } catch { found = null; }
  }
  if (found) cachePut(g, found);

  let message = '';
  if (!found) {
    if (hasToken && cz.error) {
      message = `ЧЗ ответил: ${cz.error}. Карточка в открытых базах не найдена — проверьте токен ЧЗ или заполните данные вручную.`;
    } else if (hasToken) {
      message = `В ЧЗ по коду ничего не найдено (GTIN ${g}); в открытых базах тоже нет — заполните данные вручную.`;
    } else {
      message = `GTIN ${g} не найден в открытых базах. Вставьте свой токен ЧЗ (True API) — тогда карточка придёт из «Честного ЗНАКа», либо заполните поля вручную.`;
    }
  }

  return {
    ok: true,
    gtin: g,
    decoded,
    history,
    card: found ? { ...found, cached: false } : null,
    cz: { configured: hasToken, source: cz.source, error: cz.error || '' },
    message
  };
}
