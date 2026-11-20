import fs from 'node:fs';

/**
 * Подменяет внешний логотип в готовом HTML письма на локальный файл —
 * чтобы сделать скриншот предпросмотра без сети.
 */
const [src, out, icon] = process.argv.slice(2);
const local = 'file:///' + String(icon).replace(/\\/g, '/');
const html = fs.readFileSync(src, 'utf8');
const next = html
  .replaceAll('https://code-qr.stockcity.ru/email-logo.png', local)
  .replaceAll('https://code-qr.stockcity.ru/icon-192.png', local);
fs.writeFileSync(out, next, 'utf8');
console.log(JSON.stringify({ bytes: Buffer.byteLength(next), replaced: html !== next }));
