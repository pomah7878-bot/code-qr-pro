#!/usr/bin/env bash
# Проверка PDF для AirPrint/Mopria: размер страницы в мм, заголовки, CSP страницы печати.
set -uo pipefail
cd /opt/code-qr/server

TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
if [ -z "$TOKEN" ]; then echo 'нужен session token'; exit 1; fi
CJ=/tmp/cq_final_cj.txt
rm -f "$CJ"
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"

echo "== pdf ticket =="
curl -sS -b "$CJ" -X POST "$BASE/api/labels/pdf/ticket" \
  -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' \
  -d '{"template":{"name":"QA 58x40","widthMm":58,"heightMm":40,"dpi":203,"elements":[{"id":"dm","type":"datamatrix","x":2,"y":2,"w":30,"h":30}]},"rows":[{"code":"0104638230913287215Xk!ABCdef"}],"single":false,"source":"reprint"}' \
  -o /tmp/cq_final_ticket.json -w 'ticket: %{http_code}\n'
cat /tmp/cq_final_ticket.json; echo

URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/cq_final_ticket.json','utf8')).url||'')}catch{console.log('')}")
echo "== pdf file =="
curl -sS -b "$CJ" "$BASE$URL" -o /tmp/cq_final.pdf -D /tmp/cq_final.h -w 'pdf: %{http_code} type=%{content_type} size=%{size_download}\n'
grep -i -E 'content-disposition|cache-control|x-content-type' /tmp/cq_final.h || true

echo "== pdf page size =="
node -e "
const fs = require('node:fs');
const buf = fs.readFileSync('/tmp/cq_final.pdf');
const str = buf.toString('latin1');
const media = str.match(/\\/MediaBox\\s*\\[([^\\]]+)\\]/);
const head = str.slice(0, 5);
if (!media) { console.log('MediaBox не найден'); process.exit(0); }
const [x0, y0, x1, y1] = media[1].trim().split(/\\s+/).map(Number);
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
console.log(JSON.stringify({ head, mediaBoxPt: [x0, y0, x1, y1], sizeMm: [mm(x1 - x0), mm(y1 - y0)], expectMm: [58, 40] }));
"

echo "== print page headers =="
curl -sS -b "$CJ" -D /tmp/cq_print.h -o /tmp/cq_print.html -X POST "$BASE/api/labels/print" \
  -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' \
  -d '{"template":{"name":"QA 58x40","widthMm":58,"heightMm":40,"dpi":203,"elements":[{"id":"dm","type":"datamatrix","x":2,"y":2,"w":30,"h":30}]},"rows":[{"code":"0104638230913287215Xk!ABCdef"}],"source":"reprint"}' \
  -w 'print: %{http_code} type=%{content_type}\n'
grep -i -E '^content-security-policy|^content-type' /tmp/cq_print.h | head -3
node -e "
const fs = require('node:fs');
const html = fs.readFileSync('/tmp/cq_print.html', 'utf8');
console.log(JSON.stringify({
  hasToolbar: /data-print/.test(html),
  hasExternalScript: /src=\"\/print-tools.js\"/.test(html),
  noInlineHandlers: !/onclick=/.test(html),
  hasAirPrintHint: /AirPrint/.test(html),
  hasMopriaHint: /Mopria/.test(html)
}));
"

echo "== без авторизации =="
curl -sS -o /dev/null -w 'file-noauth: %{http_code}\n' "$BASE$URL"
curl -sS -o /dev/null -w 'print-noauth: %{http_code}\n' -X POST "$BASE/api/labels/print" -H 'Content-Type: application/json' -d '{}'

rm -f "$CJ" /tmp/cq_final_ticket.json /tmp/cq_final.pdf /tmp/cq_final.h /tmp/cq_print.h /tmp/cq_print.html
