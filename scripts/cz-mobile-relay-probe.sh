#!/usr/bin/env bash
# Ищем доступный способ достучаться до публичного mobile-check ЧЗ с этого сервера.
set -uo pipefail
CODE="0104638230913287215ZsWrd"
TARGET="https://mobile.api.crpt.ru/mobile/check?code=${CODE}&codeType=datamatrix"
ENC=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$TARGET")

echo "== релеи =="
declare -a URLS=(
  "https://r.jina.ai/${TARGET}"
  "https://api.codetabs.com/v1/proxy?quest=${TARGET}"
  "https://corsproxy.io/?url=${ENC}"
  "https://api.allorigins.win/raw?url=${ENC}"
  "https://thingproxy.freeboard.io/fetch/${TARGET}"
  "https://proxy.cors.sh/${TARGET}"
)
for u in "${URLS[@]}"; do
  printf '%-60s -> ' "$(echo "$u" | cut -c1-58)"
  code=$(curl -4 -sS -m 25 -o /tmp/relay.txt -w '%{http_code}' -A "Mozilla/5.0" "$u" 2>/dev/null || echo ERR)
  printf '%s %s\n' "$code" "$(head -c 120 /tmp/relay.txt | tr -d '\r\n')"
done

echo "== Национальный каталог =="
for u in "https://nk.crpt.ru/" "https://nk.crpt.ru/api/v1/products?query=04638230913287" "https://chestnyznak.ru/"; do
  printf '%-70s -> ' "$u"
  curl -4 -sS -m 12 -o /dev/null -w '%{http_code}\n' -A "Mozilla/5.0" "$u" 2>/dev/null || echo ERR
done

echo "== веб-проверка на chestnyznak.ru =="
curl -4 -sS -m 15 -A "Mozilla/5.0" "https://chestnyznak.ru/" -o /tmp/czn.html -w 'main: %{http_code} size: %{size_download}\n' || true
grep -o -i -E 'check[-a-z]*code|api[/a-z-]*|captcha' /tmp/czn.html | sort -u | head -10 || true
rm -f /tmp/relay.txt /tmp/czn.html
