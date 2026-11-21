import { validateRow } from './gs1.js';
import { getSetting } from './settings.js';
import { checkCodeOnline, normalizeCzCode } from './lib/product-card.js';

export function czStatus() {
  const enabled = getSetting('cz_enabled', '0') === '1';
  const token = getSetting('cz_token', '');
  const apiUrl = getSetting('cz_api_url', 'https://markirovka.crpt.ru');
  return { enabled, configured: Boolean(token), apiUrl };
}

const TRUE_STATUS = {
  EMITTED: 'Нанесён', APPLIED: 'Нанесён', INTRODUCED: 'В обороте',
  RETIRED: 'Выбыл', WRITTEN_OFF: 'Списан', DISAGGREGATION: 'Расформирован', UNKNOWN: 'Нет данных'
};

/** Официальный True API (нужен действующий токен УКЭП, срок ~10 часов). */
function trueApiEndpoint(apiUrl) {
  let base = String(apiUrl || 'https://markirovka.crpt.ru').trim().replace(/\/+$/, '');
  if (!/\/api\/v3\/true-api$/.test(base)) base += '/api/v3/true-api';
  return base + '/cises/info';
}

async function checkTrueApi(code, { token, apiUrl }) {
  const res = await fetch(trueApiEndpoint(apiUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify([normalizeCzCode(code)]),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error_message || data?.message || `True API HTTP ${res.status}`);
  const item = Array.isArray(data) ? data[0] : data;
  const info = item?.cisInfo || {};
  if (!item || item.success === false) throw new Error(item?.errorMessage || 'True API: код не найден');
  return {
    found: Boolean(info.gtin || info.status),
    status: TRUE_STATUS[String(info.status || '').toUpperCase()] || String(info.status || ''),
    statusRaw: String(info.status || ''),
    crypto: 'Нет данных', // True API не отдаёт криптоподпись; при необходимости дополняем публичной проверкой
    name: info.productName || '',
    producer: info.producerName || info.ownerName || '',
    source: 'true-api'
  };
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const index = i++;
      out[index] = await fn(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return out;
}

/**
 * Проверка кодов: локальная валидация GS1 + онлайн-статус.
 * Без токена используется публичный мобильный API ЧЗ; с токеном — True API.
 */
export async function verifyCodes(codes, mode = 'cz', options = {}) {
  const st = czStatus();
  const token = String(options.token || (st.enabled ? getSetting('cz_token', '') : '') || '').trim();
  const apiUrl = String(options.apiUrl || st.apiUrl || 'https://markirovka.crpt.ru').replace(/\/$/, '');
  const onlineLimit = Math.max(0, Math.min(50, Number(options.onlineLimit ?? 20) || 0));
  const results = codes.map((c) => ({ code: String(c).slice(0, 300), ...validateRow(c, mode) }));
  const validIndexes = results.map((r, i) => (r.ok ? i : -1)).filter((i) => i >= 0).slice(0, onlineLimit);

  let onlineChecked = 0;
  let trueApiUsed = false;
  const onlineErrors = [];
  await mapLimit(validIndexes, 4, async (index) => {
    const row = results[index];
    if (token) {
      try {
        const [official, publicInfo] = await Promise.all([
          checkTrueApi(row.code, { token, apiUrl }),
          checkCodeOnline(row.code).catch(() => null)
        ]);
        Object.assign(row, publicInfo || {}, official, {
          online: true,
          onlineSource: 'true-api',
          crypto: publicInfo?.crypto || official.crypto || 'Нет данных',
          warnings: [...new Set([...(publicInfo?.warnings || []), ...(official.warnings || [])])]
        });
        trueApiUsed = true;
        onlineChecked += 1;
        return;
      } catch (e) {
        onlineErrors.push(String(e?.message || e).slice(0, 160));
        // токен мог истечь — ниже пробуем публичный API
      }
    }
    try {
      const online = await checkCodeOnline(row.code);
      Object.assign(row, online, { online: true, onlineSource: 'cz-mobile' });
      onlineChecked += 1;
    } catch (e) {
      row.online = false;
      row.onlineError = String(e?.message || e).slice(0, 160);
      onlineErrors.push(row.onlineError);
    }
  });

  const totalValid = results.filter((r) => r.ok).length;
  let message;
  if (onlineChecked > 0) {
    message = `Онлайн-проверка «Честного ЗНАКа»: ${onlineChecked} из ${totalValid} валидных кодов` +
      (trueApiUsed ? ' через официальный True API по токену' : ' через публичный API (без токена)') +
      `. Статус и криптоподпись подставлены в таблицу; остальные коды проверены локально.` +
      (onlineLimit < totalValid ? ` Онлайн проверяются первые ${onlineLimit} кодов — лимит публичного API.` : '');
  } else {
    message = 'Выполнена локальная валидация структуры GS1. Онлайн-статус не получен: ' +
      (onlineErrors[0] || 'нет валидных кодов для онлайн-проверки') +
      '. Для официального True API нужен токен УКЭП (около 10 часов), для публичной проверки статуса токен не требуется.';
  }
  return {
    configured: true,
    online: onlineChecked > 0,
    trueApi: trueApiUsed,
    onlineChecked,
    onlineLimit,
    onlineErrors,
    message,
    results
  };
}
