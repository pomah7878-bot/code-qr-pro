#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_dbg_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"
cat > /tmp/cq_dbg_body.json <<'JSON'
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
  "rows": [{"code":"0104638230913287215ZsWrd","gtin":"04638230913287","serial":"5ZsWrd"}],
  "single": true,
  "source": "reprint"
}
JSON
curl -sS -b "$CJ" -X POST "$BASE/api/labels/pdf/ticket" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' --data @/tmp/cq_dbg_body.json -o /tmp/cq_dbg_ticket.json -w 'ticket: %{http_code}\n'
cat /tmp/cq_dbg_ticket.json; echo
URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/cq_dbg_ticket.json','utf8')).url||'')}catch{console.log('')}")
curl -sS -b "$CJ" "$BASE$URL" -o /tmp/cq_dbg.pdf -D /tmp/cq_dbg.h -w 'pdf: %{http_code} type=%{content_type} size=%{size_download}\n'
head -c 8 /tmp/cq_dbg.pdf; echo
node /tmp/pdf-debug-dump.cjs /tmp/cq_dbg.pdf
node /tmp/pdf-text-extract.cjs /tmp/cq_dbg.pdf
