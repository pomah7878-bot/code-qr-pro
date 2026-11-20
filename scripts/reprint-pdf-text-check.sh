#!/usr/bin/env bash
# Генерирует PDF этикетки с подписью и проверяет, что GTIN/серийник реально в PDF.
set -uo pipefail
cd /opt/code-qr/server
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_cap2_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"
export GTIN='04638230913287'
export SERIAL='5ZsWrd'

cat > /tmp/cq_cap2_body.json <<JSON
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
  "rows": [{"code":"0104638230913287215ZsWrd","gtin":"$GTIN","serial":"$SERIAL"}],
  "single": true,
  "source": "reprint"
}
JSON

curl -sS -b "$CJ" -X POST "$BASE/api/labels/pdf/ticket" \
  -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' \
  --data @/tmp/cq_cap2_body.json -o /tmp/cq_cap2_ticket.json -w 'ticket: %{http_code}\n'
URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/cq_cap2_ticket.json','utf8')).url||'')}catch{console.log('')}")
curl -sS -b "$CJ" "$BASE$URL" -o /tmp/cq_cap2.pdf -w 'pdf: %{http_code} size=%{size_download}\n'
node /tmp/pdf-text-extract.cjs /tmp/cq_cap2.pdf
rm -f "$CJ" /tmp/cq_cap2_body.json /tmp/cq_cap2_ticket.json
