// Тест Print Bridge (при запущенном bridge.mjs): node scripts/test-bridge.mjs
import { readFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:9101';
const TOKEN = readFileSync('print-bridge/bridge-token.txt', 'utf8').trim();
function assert(cond, msg, dump) { if (!cond) { console.error('FAIL:', msg, dump ? JSON.stringify(dump).slice(0, 400) : ''); process.exit(1); } console.log('ok:', msg); }

let r = await fetch(BASE + '/ping'); let d = await r.json();
assert(d.ok === true, 'bridge ping');

r = await fetch(BASE + '/printers');
assert(r.status === 401, 'printers без токена → 401');

r = await fetch(BASE + '/printers', { headers: { 'X-Bridge-Token': TOKEN } });
d = await r.json();
assert(r.status === 200 && Array.isArray(d.printers), 'printers список: ' + JSON.stringify(d.printers));

const layout = { widthMm: 58, heightMm: 40, dpi: 203, savePng: true, elements: [
  { type: 'text', x: 2, y: 2, w: 40, h: 8, text: 'CODE QR PRO TEST', fontSize: 12, align: 'left' },
  { type: 'text', x: 2, y: 12, w: 40, h: 6, text: '58x40 mm · 203 dpi', fontSize: 8, align: 'center' }
] };
r = await fetch(BASE + '/print', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': TOKEN }, body: JSON.stringify(layout) });
d = await r.json();
assert(r.status === 200 && d.pngBase64, 'print savePng render', d);
const png = Buffer.from(d.pngBase64, 'base64');
assert(png.slice(1, 4).toString() === 'PNG', 'рендер — валидный PNG');
// проверяем размеры: 58мм@203dpi ≈ 464px, 40мм ≈ 319px
const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
assert(Math.abs(w - 464) <= 2 && Math.abs(h - 319) <= 2, `размер рендера ${w}x${h} ≈ 58x40мм@203dpi`);

console.log('\nALL BRIDGE TESTS PASSED');
