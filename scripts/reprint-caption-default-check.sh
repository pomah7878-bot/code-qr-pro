#!/usr/bin/env bash
# Проверка дефолтного режима «Только DataMatrix + подпись GTIN/серийник» (58x40).
set -uo pipefail
cd /opt/code-qr/server
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_dflt_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"
export GTIN='04638230913287'
export SERIAL='5ZsWrd'

cat > /tmp/cq_dflt_body.json <<'JSON'
{
  "template": {
    "name": "QR + подпись 58x40",
    "widthMm": 58, "heightMm": 40, "dpi": 203,
    "elements": [
      {"id":"dm","type":"datamatrix","x":13.4,"y":1.3,"w":31.2,"h":31.2},
      {"id":"capGtin","type":"field","field":"gtin","x":0.5,"y":33.5,"w":57,"h":2.9,"fontSize":6.5,"align":"left"},
      {"id":"capSerial","type":"field","field":"serial","x":0.5,"y":36.7,"w":57,"h":2.9,"fontSize":6.5,"align":"left"}
    ]
  },
  "rows": [{"code":"0104638230913287215ZsWrd","gtin":"04638230913287","serial":"5ZsWrd"}],
  "single": true,
  "source": "reprint"
}
JSON

curl -sS -b "$CJ" -X POST "$BASE/api/labels/pdf/ticket" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' --data @/tmp/cq_dflt_body.json -o /tmp/cq_dflt_ticket.json -w 'ticket: %{http_code}\n'
URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/cq_dflt_ticket.json','utf8')).url||'')}catch{console.log('')}")
curl -sS -b "$CJ" "$BASE$URL" -o /tmp/cq_dflt.pdf -w 'pdf: %{http_code} size=%{size_download}\n'
node /tmp/pdf-text-extract.cjs /tmp/cq_dflt.pdf

curl -sS -b "$CJ" -X POST "$BASE/api/labels/print" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' --data @/tmp/cq_dflt_body.json -o /tmp/cq_dflt.html -w 'print: %{http_code}\n'
node <<'NODE'
const fs = require('node:fs');
const html = fs.readFileSync('/tmp/cq_dflt.html', 'utf8');
console.log(JSON.stringify({
  hasGtin: html.includes(process.env.GTIN),
  hasSerial: html.includes(process.env.SERIAL),
  page: (html.match(/@page\s*\{[^}]*\}/) || [])[0] || null
}));
NODE

rm -f "$CJ" /tmp/cq_dflt_body.json /tmp/cq_dflt_ticket.json /tmp/cq_dflt.html /tmp/cq_dflt.pdf
