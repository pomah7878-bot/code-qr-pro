// Извлечение кодов маркировки из текста PDF.
// Строки PDF не считаются: находим только структуру КИЗ (01 GTIN, 21 серийник, 91/92 криптохвост).

export function gtinCheckDigit(gtin14) {
  const d = String(gtin14).split('').map(Number);
  if (d.length !== 14 || d.some((n) => !Number.isInteger(n))) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += d[i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === d[13];
}

const cleanText = (text) => String(text || '')
  .replace(/\r/g, '\n')
  .replace(/[\u00a0\u2007\u202f\u2009\u200b\u00ad]/g, ' ');

const SERIAL_RE = /^[\x21-\x7E]{1,20}$/;
const CRYPTO_RE = /^[A-Za-z0-9+/=]{1,90}$/;

// Собирает код в «сыром» виде с GS-разделителями: серийник может содержать скобки,
// поэтому скобочная запись для таких кодов неоднозначна.
function makeCode(gtin, serial, key, crypto) {
  if (!/^\d{14}$/.test(gtin)) return null;
  if (!SERIAL_RE.test(serial)) return null;
  if (key && !/^[\x21-\x7E]{1,8}$/.test(key)) return null;
  if (crypto && !CRYPTO_RE.test(crypto)) return null;
  let out = `01${gtin}21${serial}`;
  if (key) out += `\x1d91${key}`;
  if (crypto) out += `\x1d92${crypto}`;
  return out + '\x1d';
}

export function extractKizCodes(text) {
  const src = cleanText(text);
  const found = new Set();
  const push = (code) => { if (code) found.add(code); };

  // 1. Код в строке через пробелы: 01 046... 21 SERIAL 91 EE10 92 ...
  for (const line of src.split('\n')) {
    const m = line.match(/(?:^|\s)01\s*(\d{14})\s+21\s+([^\s()]{1,20})(?:\s+91\s+([^\s()]{1,8}))?(?:\s+92\s+([^\s()]{1,90}))?/);
    if (m) push(makeCode(m[1], m[2], m[3], m[4]));
  }

  // 2. Скобочная запись; пробелы внутри кода не мешают
  const compact = src.replace(/[\s\x00-\x1f]+/g, '');
  const paren = /\(01\)(\d{14})\(21\)([^()]{1,20})(?:\(91\)([^()]{1,8}))?(?:\(92\)([A-Za-z0-9+/=]{1,90}))?/g;
  for (const m of compact.matchAll(paren)) push(makeCode(m[1], m[2], m[3], m[4]));

  // 3. Слитная запись: 01046...215PojkV91EE1092dGVzdA==
  const plain = compact;
  const head = /01(\d{14})21/g;
  let m;
  while ((m = head.exec(plain))) {
    const gtin = m[1];
    if (!gtinCheckDigit(gtin)) continue; // в слитной записи это главный фильтр мусора
    const rest = plain.slice(m.index + m[0].length);
    for (let s = 1; s <= 20; s++) {
      if (rest.slice(s, s + 2) !== '91') continue;
      const serial = rest.slice(0, s);
      if (!SERIAL_RE.test(serial)) continue;
      const key = rest.slice(s + 2, s + 6);
      if (rest.slice(s + 6, s + 8) !== '92') continue;
      const tail = rest.slice(s + 8);
      const cryptoMatch = tail.match(/^[A-Za-z0-9+/]{8,44}={0,2}/);
      if (!cryptoMatch) continue;
      push(makeCode(gtin, serial, key, cryptoMatch[0]));
      break;
    }
  }

  return [...found];
}
