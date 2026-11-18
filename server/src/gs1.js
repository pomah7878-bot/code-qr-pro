// Разбор и валидация GS1-кодов маркировки (AI, FNC1, контрольная цифра GTIN)
const FIXED = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
const VARIABLE = new Set(['10', '21', '22', '30', '37', '240', '241', '242', '250', '251', '253', '254', '255', '91', '92', '93', '94', '95', '96', '97', '98', '99']);
const AI_RE = /^(3[1-6]\d{2}|2[45]\d|0[0-2]|1[0-7]|20|21|22|30|37|9[1-9])/;

function fixedLen(ai) {
  if (FIXED[ai]) return FIXED[ai];
  if (/^3[1-6]\d{2}$/.test(ai)) return 6;
  return null;
}

export function gtinCheckDigit(gtin14) {
  const d = gtin14.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += d[i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === d[13];
}

export function parseAIs(raw) {
  if (/\(\d{2,4}\)/.test(raw)) {
    const out = [];
    const re = /\((\d{2,4})\)([^()]*)/g;
    let m;
    while ((m = re.exec(raw))) out.push([m[1], m[2]]);
    if (!out.length) throw new Error('Не найдены AI в скобках');
    return out;
  }
  if (raw.includes('\x1d')) {
    const out = [];
    for (const seg of raw.split('\x1d').filter(Boolean)) {
      let rest = seg;
      while (rest.length) {
        const m = rest.match(AI_RE);
        if (!m) throw new Error('Не распознан AI в сегменте: ' + rest.slice(0, 10));
        const ai = m[1];
        const fl = fixedLen(ai);
        if (fl) {
          if (rest.length < ai.length + fl) throw new Error(`AI (${ai}): недостаточно данных`);
          out.push([ai, rest.slice(ai.length, ai.length + fl)]);
          rest = rest.slice(ai.length + fl);
        } else {
          out.push([ai, rest.slice(ai.length)]);
          rest = '';
        }
      }
    }
    return out;
  }
  if (/^\d{14}$/.test(raw)) return [['01', raw]];
  throw new Error('Нет GS-разделителей и скобок AI — код не распознан');
}

// Скобочная запись → «сырой» GS1 с FNC1-разделителями (GS).
// Значения могут содержать скобки, поэтому режем только по началам AI.
export function toRawGs1(code) {
  const s = String(code || '').trim().replace(/<GS>/g, '\x1d').replace(/\\x1d/g, '\x1d');
  if (!/^\(\d{2,4}\)/.test(s)) return s;
  const starts = [...s.matchAll(/\((\d{2,4})\)/g)];
  let out = '';
  let prevVariable = false;
  for (let i = 0; i < starts.length; i++) {
    const ai = starts[i][1];
    const start = starts[i].index + starts[i][0].length;
    const end = i + 1 < starts.length ? starts[i + 1].index : s.length;
    const value = s.slice(start, end);
    if (i > 0 && prevVariable) out += '\x1d';
    out += ai + value;
    prevVariable = VARIABLE.has(ai);
  }
  return out;
}

// Текст для bwip-js datamatrix: ведущий FNC1 + FNC1 вместо GS.
// Символ ^ в данных экранируется как ^^.
export function gs1BarcodeText(raw) {
  return '^FNC1' + String(raw || '').replace(/\^/g, '^^').replace(/\x1d/g, '^FNC1');
}

export function validateRow(rawInput, mode) {  let raw = String(rawInput ?? '').trim().replace(/<GS>/g, '\x1d').replace(/\\x1d/g, '\x1d');
  if (!raw) return { ok: false, error: 'Пустая строка' };
  if (mode === 'text') {
    if (raw.length > 1000) return { ok: false, error: 'Текст длиннее 1000 символов' };
    return { ok: true, normalized: raw };
  }
  let ais;
  try { ais = parseAIs(raw); } catch (e) { return { ok: false, error: e.message }; }
  const map = new Map();
  for (const [ai, val] of ais) {
    if (!fixedLen(ai) && !VARIABLE.has(ai)) return { ok: false, error: `Неизвестный AI (${ai})` };
    const fl = fixedLen(ai);
    if (fl && val.length !== fl) return { ok: false, error: `AI (${ai}): ожидалось ${fl} симв., получено ${val.length}` };
    if (map.has(ai)) return { ok: false, error: `AI (${ai}) встречается дважды` };
    map.set(ai, val);
  }
  const gtin = map.get('01');
  if (!gtin) return { ok: false, error: 'Нет AI (01) — GTIN' };
  if (!/^\d{14}$/.test(gtin)) return { ok: false, error: 'GTIN должен содержать 14 цифр' };
  if (!gtinCheckDigit(gtin)) return { ok: false, error: 'Неверная контрольная цифра GTIN' };
  const serial = map.get('21');
  if (!serial) return { ok: false, error: 'Нет AI (21) — серийный номер' };
  if (serial.length > 20) return { ok: false, error: 'Серийный номер длиннее 20 символов' };
  if (!/^[\x21-\x7E]+$/.test(serial)) return { ok: false, error: 'Серийный номер содержит недопустимые символы' };
  if (mode === 'cz' && (!map.get('91') || !map.get('92'))) {
    return { ok: false, error: 'Нет криптохвоста AI (91)/(92) — обязателен для «Честного ЗНАКа»' };
  }
  const order = ['01', '02', '17', '11', '10', '21', '240', '241', '91', '92'];
  const keys = [...map.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const normalized = keys.map(k => `(${k})${map.get(k)}`).join('');
  return { ok: true, normalized, gtin, serial };
}
