#!/usr/bin/env bash
# Проверяем этикетку только с EAN-13 (для OZON/WB): шаблон без DataMatrix, PDF нужного размера.
set -uo pipefail
cd /opt/code-qr/server
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_ean_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"

EAN=$(node -e "
const d='460701234567'.split('').map(Number);
let s=0; for(let i=0;i<12;i++) s+=d[i]*(i%2===0?1:3);
console.log('460701234567'+((10-(s%10))%10));
")
export EAN
echo "EAN-13: $EAN"

cat > /tmp/cq_ean_body.json <<JSON
{
  "template": {
    "name": "Маркетплейс EAN-13 · 58×40",
    "widthMm": 58, "heightMm": 40, "dpi": 203,
    "elements": [
      {"id":"mpEan","type":"ean13","field":"barcode","x":2,"y":2,"w":54,"h":14,"fontSize":8,"align":"left"},
      {"id":"mp_name","type":"field","field":"name","x":2,"y":18,"w":54,"h":4,"fontSize":7,"align":"left"},
      {"id":"mp_article","type":"field","field":"article","x":2,"y":23,"w":54,"h":4,"fontSize":7,"align":"left"}
    ]
  },
  "rows": [{"barcode":"$EAN","name":"Тестовый товар OZON","article":"ART-1"}],
  "single": true,
  "source": "reprint"
}
JSON

echo "== PDF =="
curl -sS -b "$CJ" -X POST "$BASE/api/labels/pdf/ticket" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' --data @/tmp/cq_ean_body.json -o /tmp/cq_ean_ticket.json -w 'ticket: %{http_code}\n'
URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/cq_ean_ticket.json','utf8')).url||'')}catch{console.log('')}")
curl -sS -b "$CJ" "$BASE$URL" -o /tmp/cq_ean.pdf -w 'pdf: %{http_code} size=%{size_download}\n'
node /tmp/pdf-text-extract.cjs /tmp/cq_ean.pdf

echo "== страница PDF =="
node -e "
const fs = require('node:fs');
const str = fs.readFileSync('/tmp/cq_ean.pdf').toString('latin1');
const m = str.match(/\\/MediaBox\\s*\\[([^\\]]+)\\]/);
const [x0,y0,x1,y1] = m ? m[1].trim().split(/\\s+/).map(Number) : [];
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
console.log(JSON.stringify({ sizeMm: m ? [mm(x1-x0), mm(y1-y0)] : null }));
"

echo "== HTML печати =="
curl -sS -b "$CJ" -X POST "$BASE/api/labels/print" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' --data @/tmp/cq_ean_body.json -o /tmp/cq_ean.html -w 'print: %{http_code}\n'
node <<'NODE'
const fs = require('node:fs');
const html = fs.readFileSync('/tmp/cq_ean.html', 'utf8');
console.log(JSON.stringify({
  hasEanImg: /data:image\/png/.test(html),
  hasName: html.includes('Тестовый товар OZON'),
  hasArticle: html.includes('ART-1'),
  hasDatamatrix: /datamatrix/i.test(html),
  labels: (html.match(/class="label"/g) || []).length,
  page: (html.match(/@page\s*\{[^}]*\}/) || [])[0] || null
}));
NODE

rm -f "$CJ" /tmp/cq_ean_body.json /tmp/cq_ean_ticket.json /tmp/cq_ean.html /tmp/cq_ean.pdf
