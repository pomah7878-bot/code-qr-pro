import { parseAIs, gtinCheckDigit } from '../gs1.js';

/**
 * Локальный разбор DataMatrix (GS1 Application Identifiers).
 * Никаких внешних вызовов: структура, контрольные цифры, даты, наличие криптохвоста.
 * Проверка структуры НЕ подтверждает подлинность кода и нахождение в обороте —
 * это отдельная проверка через внешний источник (status adapter).
 */

const KNOWN_FIXED = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
const KNOWN_VARIABLE = new Set(['10', '21', '22', '30', '37', '240', '241', '242', '250', '251', '253', '254', '255', '91', '92', '93', '94', '95', '96', '97', '98', '99']);

function fixedLen(ai) {
  if (KNOWN_FIXED[ai]) return KNOWN_FIXED[ai];
  if (/^3[1-6]\d{2}$/.test(ai)) return 6;
  return null;
}

function cleanInput(input) {
  return String(input || '')
    .replace(/<GS>/g, '\u001d')
    .replace(/\\x1d/g, '\u001d')
    .replace(/[\u00e8]/g, '')
    .trim();
}

/** YYMMDD (GS1) → dd.mm.yyyy; пустая строка, если дата некорректна. */
export function gs1Date(value) {
  const s = String(value || '').trim();
  if (!/^\d{6}$/.test(s)) return { text: '', valid: false };
  const yy = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const dd = Number(s.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return { text: '', valid: false };
  const century = yy >= 70 ? 1900 : 2000;
  const date = new Date(Date.UTC(century + yy, mm - 1, dd));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== mm - 1) return { text: '', valid: false };
  return {
    text: `${String(dd).padStart(2, '0')}.${String(mm).padStart(2, '0')}.${century + yy}`,
    iso: `${century + yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
    valid: true
  };
}

/**
 * Разобрать код. Возвращает структуру, нормализованный код, поля и список ошибок/предупреждений.
 * Парсер терпим к коротким кодам (без криптохвоста) — их можно проверять в каталоге по GTIN.
 */
export function parseDataMatrix(input) {
  const raw = cleanInput(input);
  const result = {
    ok: false,
    rawLength: raw.length,
    normalized: '',
    ais: [],
    gtin: '',
    serial: '',
    batch: '',
    productionDate: '',
    productionDateIso: '',
    expiryDate: '',
    expiryDateIso: '',
    cryptoType: '',
    crypto: { present: false, ai91: '', ai92: '', ai93: '' },
    checks: [],
    errors: [],
    warnings: []
  };
  if (!raw) {
    result.errors.push('Пустой код');
    return result;
  }
  if (raw.length > 4000) {
    result.errors.push('Код слишком длинный');
    return result;
  }

  let ais = [];
  try {
    ais = parseAIs(raw);
  } catch (e) {
    result.errors.push(String(e?.message || e));
    return result;
  }
  const map = new Map();
  for (const [ai, value] of ais) {
    const v = String(value ?? '');
    if (!v) {
      result.warnings.push(`AI (${ai}) пустой`);
      continue;
    }
    if (map.has(ai)) result.errors.push(`AI (${ai}) встречается дважды`);
    const known = fixedLen(ai) !== null || KNOWN_VARIABLE.has(ai);
    if (!known) result.warnings.push(`Неизвестный AI (${ai}) — проигнорирован в карточке`);
    const len = fixedLen(ai);
    if (len && v.length !== len) result.errors.push(`AI (${ai}): ожидалось ${len} символов, получено ${v.length}`);
    map.set(ai, v);
  }

  result.ais = [...map.entries()].map(([ai, value]) => ({ ai, value }));
  result.normalized = result.ais.map(({ ai, value }) => `(${ai})${value}`).join('');

  // GTIN (01) и контрольная цифра
  const gtin = map.get('01') || '';
  if (gtin) {
    if (!/^\d{14}$/.test(gtin)) result.errors.push('GTIN (01) должен содержать 14 цифр');
    else if (!gtinCheckDigit(gtin)) result.errors.push('Неверная контрольная цифра GTIN (01)');
    else result.checks.push({ id: 'gtin_check', ok: true, label: 'Контрольная цифра GTIN' });
    result.gtin = gtin;
  } else {
    result.errors.push('Нет AI (01) — GTIN');
  }

  const serial = map.get('21') || '';
  if (serial) {
    if (serial.length > 20) result.errors.push('Серийный номер (21) длиннее 20 символов');
    else if (!/^[\x21-\x7E]+$/.test(serial)) result.errors.push('Серийный номер (21) содержит недопустимые символы');
    else result.checks.push({ id: 'serial', ok: true, label: 'Серийный номер (21)' });
    result.serial = serial;
  } else {
    result.warnings.push('Нет AI (21) — серийного номера (короткий код)');
  }

  const batch = map.get('10') || '';
  if (batch) {
    if (batch.length > 20) result.warnings.push('Партия (10) длиннее 20 символов');
    result.batch = batch;
  }

  const produced = gs1Date(map.get('11'));
  if (map.get('11')) {
    if (!produced.valid) result.errors.push('Некорректная дата изготовления (11)');
    else {
      result.productionDate = produced.text;
      result.productionDateIso = produced.iso;
      result.checks.push({ id: 'production_date', ok: true, label: 'Дата изготовления (11)' });
    }
  }
  const expiry = gs1Date(map.get('17'));
  if (map.get('17')) {
    if (!expiry.valid) result.errors.push('Некорректная дата срока годности (17)');
    else {
      result.expiryDate = expiry.text;
      result.expiryDateIso = expiry.iso;
      result.checks.push({ id: 'expiry_date', ok: true, label: 'Срок годности (17)' });
    }
  }

  // Криптохвост: 91 (код проверки, 4), 92/93 (криптографическая часть)
  const ai91 = map.get('91') || '';
  const ai92 = map.get('92') || '';
  const ai93 = map.get('93') || '';
  if (ai91 || ai92 || ai93) {
    result.crypto.present = true;
    result.crypto.ai91 = ai91;
    result.crypto.ai92 = ai92;
    result.crypto.ai93 = ai93;
    if (ai93) result.cryptoType = 'gs1-93';
    else if (ai91 || ai92) result.cryptoType = 'kiz-91-92';
    if (ai91 && ai91.length !== 4) result.warnings.push('Код проверки (91) обычно 4 символа');
    result.checks.push({ id: 'crypto_present', ok: true, label: 'Криптографическая часть присутствует' });
  } else {
    result.warnings.push('Нет криптохвоста (91)/(92)/(93) — статус в обороте проверить нельзя');
  }

  result.ok = Boolean(result.gtin) && result.errors.length === 0;
  return result;
}

/** Краткий разбор для логов/админки (без полного кода). */
export function codeFingerprint(input) {
  const parsed = parseDataMatrix(input);
  return {
    gtin: parsed.gtin,
    hasSerial: Boolean(parsed.serial),
    crypto: parsed.cryptoType,
    errors: parsed.errors.length
  };
}
