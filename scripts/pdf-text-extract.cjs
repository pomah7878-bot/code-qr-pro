// Извлекает текст из PDF, сгенерированного PDFKit (подмножество TTF + ToUnicode CMap).
// Нужен для проверки, что читаемые GTIN/серийник реально нарисованы на этикетке.
const fs = require('node:fs');
const zlib = require('node:zlib');

const file = process.argv[2];
const buf = fs.readFileSync(file);
const latin = buf.toString('latin1');

// 1) Разбираем все потоки
const streams = [];
let idx = 0;
for (let guard = 0; guard < 2000; guard += 1) {
  const start = latin.indexOf('stream', idx);
  if (start < 0) break;
  const end = latin.indexOf('endstream', start);
  if (end < 0) break;
  let bodyStart = start + 6;
  while (bodyStart < end && (latin[bodyStart] === '\r' || latin[bodyStart] === '\n')) bodyStart += 1;
  const chunk = buf.subarray(bodyStart, end);
  let text = '';
  try { text = zlib.inflateSync(chunk).toString('latin1'); } catch { text = chunk.toString('latin1'); }
  streams.push(text);
  idx = end + 9;
}

// 2) ToUnicode CMap: gid -> unicode
const gidMap = new Map();
for (const s of streams) {
  if (!s.includes('beginbfchar') && !s.includes('beginbfrange')) continue;
  const bfchar = s.match(/beginbfchar([\s\S]*?)endbfchar/g) || [];
  for (const block of bfchar) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,})>/g)) {
      gidMap.set(parseInt(m[1], 16), Buffer.from(m[2], 'hex').toString('utf16le').replace(/\u0000/g, ''));
    }
  }
  const bfrange = s.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
  for (const block of bfrange) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>\s*(\[[^\]]*\]|<[0-9A-Fa-f]{4,}>)/g)) {
      const from = parseInt(m[1], 16);
      const to = parseInt(m[2], 16);
      const dst = m[3];
      if (dst.startsWith('[')) {
        const items = [...dst.matchAll(/<([0-9A-Fa-f]{4,})>/g)].map((x) => x[1]);
        items.forEach((hex, i) => {
          const g = from + i;
          const code = parseInt(hex, 16);
          gidMap.set(g, String.fromCharCode(code));
        });
      } else {
        const base = parseInt(dst.slice(1, 5), 16);
        for (let g = from; g <= to; g += 1) gidMap.set(g, String.fromCharCode(base + (g - from)));
      }
    }
  }
}

// 3) Контент-потоки: hex-строки перед Tj/TJ
function decodeToken(hex) {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const gid = parseInt(hex.slice(i, i + 4), 16);
    out += gidMap.get(gid) ?? '';
  }
  return out;
}
const texts = [];
for (const s of streams) {
  if (!/\bTJ\b|\bTj\b/.test(s)) continue;
  for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*(?:Tj|TJ)/g)) texts.push(decodeToken(m[1]));
  for (const m of s.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    for (const hm of m[1].matchAll(/<([0-9A-Fa-f]+)>/g)) texts.push(decodeToken(hm[1]));
  }
  for (const m of s.matchAll(/\(([^)]*)\)\s*Tj/g)) texts.push(m[1]);
}

const all = texts.join('');
const spaced = texts.join(' ');
const gtin = process.env.GTIN || '04638230913287';
const serial = process.env.SERIAL || '5ZsWrd';
console.log(JSON.stringify({
  gidMappings: gidMap.size,
  textChunks: texts.length,
  decodedSample: texts.slice(0, 8),
  hasGtin: all.includes(gtin) || spaced.includes(gtin),
  hasSerial: all.includes(serial) || spaced.includes(serial),
  joined: all.slice(0, 40)
}));
