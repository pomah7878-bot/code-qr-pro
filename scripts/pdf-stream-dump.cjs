// Диагностика структуры PDF: показать фрагменты потоков (шрифты/контент).
const fs = require('node:fs');
const zlib = require('node:zlib');
const buf = fs.readFileSync(process.argv[2]);
const latin = buf.toString('latin1');
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
streams.forEach((s, i) => {
  if (/beginbf|Tj|TJ|BaseFont|FontFile/.test(s)) {
    console.log(`--- stream ${i} (${s.length} bytes) ---`);
    console.log(s.slice(0, 700).replace(/\n/g, '\\n'));
  }
});
