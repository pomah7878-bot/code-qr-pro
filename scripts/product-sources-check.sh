#!/usr/bin/env bash
# Проверяем доступность открытых источников информации о товаре по GTIN/коду.
set -uo pipefail
GTIN_TEST="3017620422003"
UA="CODE-QR-PRO/1.0 (support@code-qr.stockcity.ru)"

echo "== Open Food Facts =="
curl -4 -sS -m 12 -A "$UA" "https://world.openfoodfacts.org/api/v2/product/${GTIN_TEST}.json?fields=code,product_name,brands,quantity,categories" -o /tmp/off.json -w 'http: %{http_code} time: %{time_total}\n'
head -c 300 /tmp/off.json; echo

echo "== Open Beauty Facts =="
curl -4 -sS -m 12 -A "$UA" "https://world.openbeautyfacts.org/api/v2/product/${GTIN_TEST}.json?fields=code,product_name,brands,quantity,categories" -o /tmp/obf.json -w 'http: %{http_code}\n'
head -c 200 /tmp/obf.json; echo

echo "== Open Products Facts =="
curl -4 -sS -m 12 -A "$UA" "https://world.openproductsfacts.org/api/v2/product/${GTIN_TEST}.json?fields=code,product_name,brands,quantity,categories" -o /tmp/opf.json -w 'http: %{http_code}\n'
head -c 200 /tmp/opf.json; echo

echo "== GS1 GEPIR (web, без ключа) =="
curl -4 -sS -m 10 -o /dev/null -w 'gepir: %{http_code}\n' "https://gepir.gs1.org/index.php/search-by-gtin/${GTIN_TEST}" || true

echo "== ЧЗ True API без токена =="
curl -4 -sS -m 10 -o /tmp/cz.json -w 'cz: %{http_code}\n' -X POST "https://api.mdlp.crpt.ru/api/v3/true-api/cises/info" -H 'Content-Type: application/json' -d '["0104638230913287215ZsWrd"]'
head -c 200 /tmp/cz.json; echo

rm -f /tmp/off.json /tmp/obf.json /tmp/opf.json /tmp/cz.json
