// Форматирование дат и денег для админки. SQLite хранит UTC без пояса.
const toDate = (s) => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
};

export function fmtDate(s) {
  const d = toDate(s);
  return d ? d.toLocaleDateString('ru-RU') : '';
}

export function fmtDateTime(s) {
  const d = toDate(s);
  return d ? d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}

export function money(v) {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}

export function daysLeft(s) {
  const d = toDate(s);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
