#!/usr/bin/env bash
# Проверяет, что читаемые GTIN и серийник реально попадают в шаблон и в PDF
# (текст ищем в распакованных потоках PDF).
set -uo pipefail
cd /opt/code-qr/server
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_cap_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"
export GTIN='04638230913287'
export SERIAL='5ZsWrd'
export CODE='0104638230913287215ZsWrd'

cat > /tmp/cq_cap_body.json <<JSON
{
  "template": {
    "name": "QA caption 58x40",
    "widthMm": 58, "heightMm": 40, "dpi": 203,
    "elements": [
      {"id":"dm","type":"datamatrix","x":2,"y":2,"w":18,"h":18},
      {"id":"capGtin","type":"field","field":"gtin","x":2,"y":22,"w":54,"h":2.9,"fontSize":6.5,"align":"left"},
      {"id":"capSerial","type":"field","field":"serial","x":2,"y":25.2,"w":54,"h":2.9,"fontSize":6.5,"align":"left"}
    ]
  },
  "rows": [{"code":"$CODE","gtin":"$GTIN","serial":"$SERIAL"}],
  "single": true,
  "source": "reprint"
}
JSON

echo "== print html =="
curl -sS -b "$CJ" -X POST "$BASE/api/labels/print" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' --data @/tmp/cq_cap_body.json -o /tmp/cq_cap.html -w 'print: %{http_code}\n'
node <<'NODE'
const fs = require('node:fs');
const html = fs.readFileSync('/tmp/cq_cap.html', 'utf8');
console.log(JSON.stringify({
  hasGtin: html.includes(process.env.GTIN),
  hasSerial: html.includes(process.env.SERIAL),
  labels: (html.match(/class="label"/g) || []).length
}));
NODE

echo "== pdf ticket =="
curl -sS -b "$CJ" -X POST "$BASE/api/labels/pdf/ticket" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' --data @/tmp/cq_cap_body.json -o /tmp/cq_cap_ticket.json -w 'ticket: %{http_code}\n'
URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/cq_cap_ticket.json','utf8')).url||'')}catch{console.log('')}")
curl -sS -b "$CJ" "$BASE$URL" -o /tmp/cq_cap.pdf -w 'pdf: %{http_code} size=%{size_download}\n'

echo "== разбор PDF =="
node <<'NODE'
const fs = require('node:fs');
const zlib = require('node:zlib');
const buf = fs.readFileSync('/tmp/cq_cap.pdf');
const latin = buf.toString('latin1');
const parts = [];
let idx = 0;
for (let guard = 0; guard < 500; guard += 1) {
  const start = latin.indexOf('stream', idx);
  if (start < 0) break;
  const end = latin.indexOf('endstream', start);
  if (end < 0) break;
  let bodyStart = start + 6;
  while (bodyStart < end && (latin[bodyStart] === '\r' || latin[bodyStart] === '\n')) bodyStart += 1;
  const chunk = buf.subarray(bodyStart, end);
  try { parts.push(zlib.inflateSync(chunk).toString('latin1')); } catch { parts.push(chunk.toString('latin1')); }
  idx = end + 9;
}
const text = parts.join('\n');
const media = latin.match(/\/MediaBox\s*\[([^\]]+)\]/);
const [x0, y0, x1, y1] = media ? media[1].trim().split(/\s+/).map(Number) : [];
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
console.log(JSON.stringify({
  pdfHead: latin.slice(0, 5),
  streams: parts.length,
  hasGtin: text.includes(process.env.GTIN),
  hasSerial: text.includes(process.env.SERIAL),
  pageMm: media ? [mm(x1 - x0), mm(y1 - y0)] : null,
  digitsFound: (text.match(/\d{14}/g) || []).slice(0, 3)
}));
NODE

rm -f "$CJ" /tmp/cq_cap_body.json /tmp/cq_cap.html /tmp/cq_cap_ticket.json /tmp/cq_cap.pdf
