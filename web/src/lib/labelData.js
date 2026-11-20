// Данные для редактора этикеток: КИЗ из PDF/CSV и таблицы из BarTender.
// xlsx (~400 КБ) грузится только когда пользователь реально выбрал таблицу —
// раньше он попадал в стартовый бандл и замедлял загрузку любой страницы.
let xlsxPromise = null;

function loadXlsx() {
  if (!xlsxPromise) xlsxPromise = import('xlsx');
  return xlsxPromise;
}

// Известные двухзначные идентификаторы GS1 (остальные считаем 3-4-значными, как 240/241/8005).
const AI_2 = new Set(['00', '01', '02', '10', '11', '12', '13', '15', '16', '17', '20', '21', '22', '30', '37', '90', '91', '92', '93', '94', '95', '96', '97', '98', '99']);

export function toParen(raw) {
  const s = String(raw || '').trim();
  if (/^\(\d{2,4}\)/.test(s)) return s;
  const parts = s.split('\x1d');
  const head = parts.shift() || '';
  const m = head.match(/^01(\d{14})21([\s\S]*)$/);
  if (!m) return s;
  let out = `(01)${m[1]}(21)${m[2]}`;
  for (const part of parts) {
    if (!part) continue;
    let ai = part.slice(0, 2);
    let rest = part.slice(2);
    if (!AI_2.has(ai)) {
      if (/^800[5-8]/.test(part)) {
        ai = part.slice(0, 4);
        rest = part.slice(4);
      } else {
        ai = part.slice(0, 3);
        rest = part.slice(3);
      }
    }
    if (/^\d{2,4}$/.test(ai)) out += `(${ai})${rest}`;
  }
  return out;
}

export function normalizeScanInput(input) {
  let s = String(input || '').replace(/^\uFEFF/, '').trim();
  // Сканеры GS1 часто добавляют префикс идентификатора символологии: ]d2, ]Q3, ]e0, ]C1.
  s = s.replace(/^\][A-Za-z0-9]{2}/, '');
  // Невидимые управляющие/zero-width символы в начале и конце, но НЕ внутри кода.
  s = s.replace(/^[\u0000-\u001f\u007f\u200b-\u200d]+/, '').replace(/[\u0000-\u001f\u007f\u200b-\u200d]+$/, '');
  return s;
}

// Один КИЗ в любой записи → строка для редактора
export function parseKiz(input) {
  let s = normalizeScanInput(input);
  if (!s || s.startsWith('#') || /^(code|код|киз|gtin|serial)\b/i.test(s)) return null;
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"');
  if (s.includes('(01)')) {
    const gtin = (s.match(/\(01\)(\d{14})/) || [])[1];
    const serial = (s.match(/\(21\)([\s\S]*?)(?=\(\d{2,4}\)|$)/) || [])[1]?.trim();
    if (!gtin || !serial) return null;
    return { code: s.replace(/\s+/g, ''), gtin, serial, short: !/\(91\)[\s\S]*\(92\)/.test(s) };
  }
  const raw = s.replace(/\s+/g, '');
  const m = raw.match(/^01(\d{14})21([^\x1d]*)/);
  if (!m) return null;
  return {
    code: toParen(raw),
    gtin: m[1],
    serial: m[2],
    short: !/\x1d91[^\x1d]*\x1d92[\s\S]+/.test(raw)
  };
}

export function kizRows(codes) {
  const out = [];
  for (const c of codes) {
    const k = parseKiz(c);
    if (k) out.push({ ...k, row: String(out.length + 1) });
  }
  return out;
}

// Строки из CSV/TXT с кодами (по одному на строку или в ячейке)
export function codeLinesFromText(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const direct = parseKiz(trimmed);
    if (direct) { out.push(trimmed); continue; }
    const cells = trimmed.split(/[;\t,]/);
    for (const cell of cells) if (parseKiz(cell)) { out.push(cell); break; }
  }
  return out;
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = { '\t': (sample.match(/\t/g) || []).length, ';': (sample.match(/;/g) || []).length, ',': (sample.match(/,/g) || []).length };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ';';
}

export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}

const COLUMN_ALIASES = [
  [/^(баркод|штрихкод|штрих-код|barcode|ean-?13|ean13)$/i, 'barcode'],
  [/^(артикул|sku|offer[ _-]?id|seller[ _-]?sku)$/i, 'sku'],
  [/^(наименование|название|товар|name|product)$/i, 'name'],
  [/^(киз|код маркировки|код|code|cis|sntins)$/i, 'code'],
  [/^(gtin|гтин)$/i, 'gtin'],
  [/^(серийник|серийный номер|serial)$/i, 'serial'],
  [/^(партия|batch)$/i, 'batch'],
  [/^(цена|price)$/i, 'price']
];

function canonicalKey(value) {
  const s = String(value || '').trim();
  for (const [re, key] of COLUMN_ALIASES) if (re.test(s)) return key;
  return s;
}

export function tableToRows(table) {
  if (!table.length) return { rows: [], columns: [] };
  if (table.length === 1 && table[0].length === 1) {
    const raw = normalizeScanInput(table[0][0]);
    const k = parseKiz(raw);
    if (k) return { rows: [{ ...k, row: '1' }], columns: Object.keys(k) };
    // Одна строка с обычным штрихкодом EAN/UPC — не КИЗ, но это валидные данные.
    if (/^\d{8,14}$/.test(raw)) {
      return { rows: [{ barcode: raw, row: '1' }], columns: ['barcode', 'row'] };
    }
    return { rows: [], columns: [] };
  }
  const first = table[0];
  const looksHeader = first.some((c) => /^(code|код|киз|gtin|serial|серий|наимен|name|крипто|crypto|дата|date|цена|price|баркод|штрихкод|barcode|sku|артикул|set|setcode|component|componentcode|componentgtin|набор|кин|компонент)$/i.test(String(c).trim().replace(/[\s_-]+/g, '')));
  const header = looksHeader ? first : first.map((_, i) => `col${i + 1}`);
  const body = looksHeader ? table.slice(1) : table;
  const columns = [];
  header.forEach((h, i) => {
    let key = canonicalKey(h) || `col${i + 1}`;
    key = key.slice(0, 40);
    while (columns.includes(key)) key = `${key}_${i + 1}`;
    columns.push(key);
  });
  const rows = [];
  for (const cells of body) {
    if (!cells.some((c) => String(c).trim())) continue;
    const obj = {};
    columns.forEach((key, i) => { obj[key] = String(cells[i] ?? '').slice(0, 1000); });
    rows.push(obj);
  }
  return { rows, columns };
}

function parseXmlRows(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Некорректный XML');
  const named = [...doc.querySelectorAll('NamedSubString')];
  if (named.length) {
    const row = {};
    named.forEach((node, i) => {
      const name = node.getAttribute('Name') || node.querySelector('Name')?.textContent?.trim() || `field${i + 1}`;
      const value = node.querySelector('Value')?.textContent ?? node.textContent ?? '';
      row[name] = String(value).trim();
    });
    return { rows: [row], columns: Object.keys(row) };
  }
  const records = [...doc.querySelectorAll('Record, record, Row, row')];
  if (records.length) {
    const rows = records.map((node) => {
      const obj = {};
      for (const child of [...node.children]) obj[child.tagName] = child.textContent.trim();
      return obj;
    });
    return { rows, columns: Object.keys(rows[0] || {}) };
  }
  throw new Error('В XML не найдены записи (NamedSubString или Record/Row)');
}

export async function readDataFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'btw') {
    return { rows: [], columns: [], warning: `${file.name}: .btw — бинарный шаблон BarTender, макет не импортируется. Загрузите данные (CSV/XLSX/BTXML) или соберите макет вручную.` };
  }
  if (['csv', 'txt', 'tsv', 'dat'].includes(ext)) {
    const text = await file.text();
    if (text.includes('\u0000')) return { rows: [], columns: [], warning: `${file.name}: бинарный файл, не таблица` };
    const delimiter = ext === 'tsv' ? '\t' : ext === 'csv' ? ';' : detectDelimiter(text);
    const table = parseDelimited(text, delimiter);
    const result = tableToRows(table);
    if (!result.rows.length) {
      const codes = codeLinesFromText(text);
      if (codes.length) {
        const rows = kizRows(codes);
        return { rows, columns: ['code', 'gtin', 'serial', 'row'], warning: '' };
      }
    }
    return { ...result, warning: '' };
  }
  if (['xlsx', 'xls'].includes(ext)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return { ...tableToRows(table), warning: '' };
  }
  if (['xml', 'btxml'].includes(ext)) {
    return { ...parseXmlRows(await file.text()), warning: '' };
  }
  if (ext === 'json') {
    const parsed = JSON.parse(await file.text());
    if (Array.isArray(parsed) && parsed.every((x) => x && typeof x === 'object')) {
      return { rows: parsed.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')]))), columns: Object.keys(parsed[0] || {}) };
    }
    throw new Error('JSON должен быть массивом объектов');
  }
  throw new Error(`Формат .${ext} не поддерживается`);
}

export async function readSpreadsheet(file) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}
