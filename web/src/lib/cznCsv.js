// Сборка CSV для отчёта о нанесении в «Честном знаке».
// Полный код: 01+GTIN+21+серийник + GS + 91+ключ + GS + 92+криптохвост.
// CSV: каждое поле в кавычках, внутренние кавычки удваиваются (RFC 4180).

export function toRawCzn(code) {
  const src = String(code || '').trim();
  if (!src) return null;
  if (/^\(01\)/.test(src) || /\(01\)\d{14}/.test(src)) {
    const map = {};
    const re = /\((\d{2,4})\)([^()]*)/g;
    let m;
    while ((m = re.exec(src))) map[m[1]] = m[2];
    if (!/^\d{14}$/.test(map['01'] || '') || !map['21']) return null;
    let out = `01${map['01']}21${map['21']}`;
    if (map['91']) out += `\x1d91${map['91']}`;
    if (map['92']) out += `\x1d92${map['92']}`;
    return out;
  }
  const raw = src.replace(/\s+/g, '');
  return /^01\d{14}21/.test(raw) ? raw : null;
}

export function buildCznCsv(codes) {
  const rows = [];
  for (const code of codes) {
    let raw = toRawCzn(code);
    if (!raw) continue;
    raw = raw.replace(/\x1d+$/, '');
    if (!raw.includes('\x1d91') || !raw.includes('\x1d92')) {
      return { error: 'В кодах нет криптохвоста 91/92 — для отчёта о нанесении нужны полные коды.' };
    }
    rows.push('"' + raw.replace(/"/g, '""') + '"');
  }
  if (!rows.length) return { error: 'Нет кодов для выгрузки.' };
  return {
    csv: '\uFEFF' + rows.join('\r\n') + '\r\n',
    count: rows.length
  };
}

export function downloadCznCsv(csv, count) {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `marking_codes_chestny_znak_${stamp}_${count}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
