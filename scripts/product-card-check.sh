#!/usr/bin/env bash
# Проверка карточки товара по коду: Open Food Facts, открытый GS1-код, неизвестный код.
set -uo pipefail
cd /opt/code-qr/server
BASE="https://code-qr.stockcity.ru"
TOKEN="${1:-}"
CJ=/tmp/cq_card_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"

call() {
  local label="$1"; shift
  curl -sS -b "$CJ" -X POST "$BASE/api/product/cards" \
    -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' \
    -d "$1" -o /tmp/cq_card.json -w "$label: %{http_code}\n"
  node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/cq_card.json','utf8'));
const c = d.cards && d.cards[0];
console.log(JSON.stringify({
  gtin: c && c.gtin,
  found: Boolean(c && c.card),
  name: c && c.card && c.card.name,
  brand: c && c.card && c.card.brand,
  category: c && c.card && c.card.category,
  quantity: c && c.card && c.card.quantity,
  source: c && c.card && c.card.sourceLabel,
  message: c && c.message,
  cz: c && c.cz
}));
"
}

echo '== Nutella (EAN-13 в открытой базе) =='
call nutella '{"codes":[{"code":"010301762042200321ABC123","gtin":""}]}'

echo '== код из вопроса (СЫВОРОТКА LФ) =='
call sevorotka '{"codes":[{"code":"0104638230913287215ZsWrd","gtin":""}]}'

echo '== неизвестный GTIN =='
call unknown '{"codes":[{"code":"010000000000001721XYZ","gtin":""}]}'

echo '== без авторизации =='
curl -sS -o /dev/null -w 'noauth: %{http_code}\n' -X POST "$BASE/api/product/cards" -H 'Content-Type: application/json' -d '{"codes":["0104638230913287215ZsWrd"]}'

rm -f "$CJ" /tmp/cq_card.json
