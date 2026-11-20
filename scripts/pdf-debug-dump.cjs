const fs = require('node:fs');
const zlib = require('node:zlib');
const buf = fs.readFileSync(process.argv[2]);
const latin = buf.toString('latin1');
console.log('file bytes:', buf.length, 'head:', latin.slice(0, 8));
const streams = [];
let idx = 0;
for (let guard = 0; guard < 5000; guard += 1) {
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
console.log('streams:', streams.length, 'lengths:', streams.map((s) => s.length).join(','));
const tjs = streams.filter((s) => /Tj|TJ/.test(s));
console.log('streams with Tj:', tjs.length);
tjs.slice(0, 3).forEach((s, i) => console.log(`--- content ${i} ---\n${s.slice(0, 900)}`));
const cmaps = streams.filter((s) => /beginbf/.test(s));
console.log('cmap streams:', cmaps.length);
cmaps.slice(0, 2).forEach((s, i) => console.log(`--- cmap ${i} ---\n${s.slice(0, 500)}`));
