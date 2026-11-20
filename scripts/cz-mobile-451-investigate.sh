#!/usr/bin/env bash
# Разбираемся, почему mobile.api.crpt.ru отдаёт 451 и что нужно, чтобы прошёл запрос.
set -uo pipefail
CODE="0104638230913287215ZsWrd"
URL="https://mobile.api.crpt.ru/mobile/check?code=${CODE}&codeType=datamatrix"

echo "== заголовки ответа 451 =="
curl -4 -sS -m 15 -D /tmp/h451.txt -o /tmp/b451.txt \
  -A "Chestnyznak/4.47.0 (chestnyznak-mcp)" -H 'Accept: application/json' "$URL" -w 'http: %{http_code}\n' || true
cat /tmp/h451.txt | head -25
echo '--- body ---'; head -c 300 /tmp/b451.txt; echo

echo "== варианты запросов =="
try() {
  local label="$1"; shift
  local code
  code=$(curl -4 -sS -m 15 -o /tmp/out.txt -w '%{http_code}' "$@" "$URL" 2>/dev/null || echo ERR)
  printf '%-32s -> %s %s\n' "$label" "$code" "$(head -c 80 /tmp/out.txt | tr -d '\n' | tr -d '\r')"
}
try "browser UA"            -A "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
try "no UA"                 -H 'User-Agent:'
try "http2"                 --http2 -A "Chestnyznak/4.47.0"
try "X-Requested-With"      -H 'X-Requested-With: com.crpt.chestnyznak' -A "Chestnyznak/4.47.0"
try "device headers"        -H 'X-Device-Id: 123e4567-e89b-12d3-a456-426614174000' -H 'X-Platform: android' -A "Chestnyznak/4.47.0"
try "no codeType"           -A "Chestnyznak/4.47.0" "https://mobile.api.crpt.ru/mobile/check?code=${CODE}"

echo "== другие хосты =="
for u in "https://mobile.api.crpt.ru/mobile/" "https://mobile.crpt.ru/mobile/check?code=${CODE}&codeType=datamatrix" \
         "https://mobile.api.sandbox.crptech.ru/mobile/check?code=${CODE}&codeType=datamatrix" \
         "https://api.crpt.ru/mobile/check?code=${CODE}&codeType=datamatrix"; do
  printf '%-75s -> ' "$u"
  curl -4 -sS -m 12 -o /dev/null -w '%{http_code}\n' -A "Chestnyznak/4.47.0" "$u" 2>/dev/null || echo ERR
done

echo "== IPv6 =="
curl -6 -sS -m 10 -o /dev/null -w 'ipv6: %{http_code}\n' -A "Chestnyznak/4.47.0" "$URL" 2>&1 | tail -1 || true

echo "== публичные прокси (если доступны) =="
curl -4 -sS -m 20 -o /tmp/px1.txt -w 'allorigins: %{http_code}\n' "https://api.allorigins.win/raw?url=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$URL', safe=''))")" 2>/dev/null || echo 'allorigins ERR'
head -c 200 /tmp/px1.txt 2>/dev/null; echo

rm -f /tmp/h451.txt /tmp/b451.txt /tmp/out.txt /tmp/px1.txt
