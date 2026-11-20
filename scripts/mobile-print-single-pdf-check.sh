#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_single_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"

for SIZE in "58 40" "43 25" "58 80"; do
  W=$(echo "$SIZE" | cut -d' ' -f1)
  H=$(echo "$SIZE" | cut -d' ' -f2)
  curl -sS -b "$CJ" -X POST "$BASE/api/labels/pdf/ticket" \
    -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' \
    -d "{\"template\":{\"name\":\"QA\",\"widthMm\":$W,\"heightMm\":$H,\"dpi\":203,\"elements\":[{\"id\":\"dm\",\"type\":\"datamatrix\",\"x\":2,\"y\":2,\"w\":20,\"h\":20}]},\"rows\":[{\"code\":\"0104638230913287215Xk!ABCdef\"}],\"single\":true,\"source\":\"reprint\"}" \
    -o /tmp/cq_single_ticket.json -w "ticket ${W}x${H}: %{http_code}\n"
  URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/cq_single_ticket.json','utf8')).url||'')}catch{console.log('')}")
  curl -sS -b "$CJ" "$BASE$URL" -o /tmp/cq_single.pdf -w "pdf: %{http_code} size=%{size_download}\n"
  node -e "
const fs = require('node:fs');
const str = fs.readFileSync('/tmp/cq_single.pdf').toString('latin1');
const m = str.match(/\\/MediaBox\\s*\\[([^\\]]+)\\]/);
const [x0,y0,x1,y1] = m ? m[1].trim().split(/\\s+/).map(Number) : [];
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
console.log(JSON.stringify({ expect: [${W}, ${H}], actualMm: m ? [mm(x1-x0), mm(y1-y0)] : null, ok: m ? Math.abs(mm(x1-x0)-${W}) <= 1.5 && Math.abs(mm(y1-y0)-${H}) <= 1.5 : false }));
"
done
rm -f "$CJ" /tmp/cq_single_ticket.json /tmp/cq_single.pdf
