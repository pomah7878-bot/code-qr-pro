// Данные для редактора этикеток: КИЗ из PDF/CSV и таблицы из BarTender.
import * as XLSX from 'xlsx';

export function toParen(raw) {
  const s = String(raw || '').trim();
  if (/^\(\d{2,4}\)/.test(s)) return s;
  const m = s.match(/^01(\d{14})21([^\x1d]*)(?:\x1d91([^\x1d]*))?(?:\x1d92([\s\S]*))?$/);
  if (!m) return s;
  return `(01)${m[1]}(21)${m[2]}${m[3] ? `(91)${m[3]}` : ''}${m[4] ? `(92)${m[4]}` : ''}`;
}

// Один КИЗ в любой записи → строка для редактора
export function parseKiz(input) {
  let s = String(input || '').trim();
  if (!s || s.startsWith('#') || /^(code|код|киз|gtin|serial)\b/i.test(s)) return null;
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"');
  if (s.includes('(01)')) {
    const gtin = (s.match(/\(01\)(\d{14})/) || [])[1];
    const serial = (s.match(/\(21\)([\s\S]*?)(?=\(\d{2,4}\)|$)/) || [])[1]?.trim();
    if (!gtin || !serial) return null;
    return { code: s.replace(/\s+/g, ''), gtin, serial };
  }
  const raw = s.replace(/\s+/g, '');
  const m = raw.match(/^01(\d{14})21([^\x1d]*)/);
  if (!m) return null;
  return { code: toParen(raw), gtin: m[1], serial: m[2] };
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

export function tableToRows(table) {
  if (!table.length) return { rows: [], columns: [] };
  if (table.length === 1 && table[0].length === 1) {
    const k = parseKiz(table[0][0]);
    return k ? { rows: [{ ...k, row: '1' }], columns: Object.keys(k) } : { rows: [], columns: [] };
  }
  const first = table[0];
  const looksHeader = first.some((c) => /^(code|код|киз|gtin|serial|серий|наимен|name|крипто|crypto|дата|date|цена|price)$/i.test(String(c).trim()));
  const header = looksHeader ? first : first.map((_, i) => `col${i + 1}`);
  const body = looksHeader ? table.slice(1) : table;
  const columns = [];
  header.forEach((h, i) => {
    let key = String(h || `col${i + 1}`).trim().slice(0, 40) || `col${i + 1}`;
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
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}
