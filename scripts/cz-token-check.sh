#!/usr/bin/env bash
# Проверка личного токена ЧЗ: сохранение, статус, ошибка неверного токена, отключение.
set -uo pipefail
cd /opt/code-qr/server
BASE="https://code-qr.stockcity.ru"
TOKEN="${1:-}"
CJ=/tmp/cq_cztok_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"
ORIGIN='Origin: https://code-qr.stockcity.ru'

echo "== статус до =="
curl -sS -b "$CJ" "$BASE/api/cz/token" -w ' [%{http_code}]\n'

echo "== сохраняем неверный токен =="
curl -sS -b "$CJ" -X PUT "$BASE/api/cz/token" -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d '{"token":"invalid-test-token-0000000000000000"}' -w ' [%{http_code}]\n'

echo "== статус после (токен замаскирован) =="
curl -sS -b "$CJ" "$BASE/api/cz/token" -w ' [%{http_code}]\n'

echo "== карточка по коду с неверным токеном =="
curl -sS -b "$CJ" -X POST "$BASE/api/product/cards" -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d '{"codes":[{"code":"0104638230913287215ZsWrd","gtin":""}]}' -o /tmp/cq_cztok_card.json -w ' [%{http_code}]\n'
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/cq_cztok_card.json','utf8'));
const c = d.cards && d.cards[0];
console.log(JSON.stringify({
  gtin: c && c.gtin,
  found: Boolean(c && c.card),
  cz: c && c.cz,
  message: c && c.message
}, null, 1));
"

echo "== отключаем токен =="
curl -sS -b "$CJ" -X PUT "$BASE/api/cz/token" -H 'Content-Type: application/json' -H "$ORIGIN" -d '{"token":""}' -w ' [%{http_code}]\n'
curl -sS -b "$CJ" "$BASE/api/cz/token" -w ' [%{http_code}]\n'

echo "== короткий токен (валидация) =="
curl -sS -b "$CJ" -X PUT "$BASE/api/cz/token" -H 'Content-Type: application/json' -H "$ORIGIN" -d '{"token":"abc"}' -w ' [%{http_code}]\n'

rm -f "$CJ" /tmp/cq_cztok_card.json
