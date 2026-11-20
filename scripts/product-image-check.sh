#!/usr/bin/env bash
# Проверка прокси картинок товара: разрешённый хост (OFF) и запрещённый.
set -uo pipefail
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_img_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"

IMG=$(curl -sS -m 15 "https://world.openfoodfacts.org/api/v2/product/3017620422003.json?fields=image_front_url" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log((JSON.parse(s).product||{}).image_front_url||'')}catch(e){console.log('')}})")
echo "image url: $IMG"

if [ -n "$IMG" ]; then
  ENC=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$IMG")
  curl -sS -b "$CJ" -o /tmp/prodimg.bin -w 'allowed proxy: %{http_code} type=%{content_type} size=%{size_download}\n' "$BASE/api/product/image?url=$ENC"
  head -c 8 /tmp/prodimg.bin | od -An -tx1 | head -1
fi

echo "== запрещённый хост =="
curl -sS -b "$CJ" -o /tmp/bad.json -w 'blocked: %{http_code}\n' "$BASE/api/product/image?url=https%3A%2F%2Fexample.com%2Fx.png"
cat /tmp/bad.json; echo

echo "== без авторизации =="
curl -sS -o /dev/null -w 'noauth: %{http_code}\n' "$BASE/api/product/image?url=https%3A%2F%2Fexample.com%2Fx.png"

rm -f "$CJ" /tmp/prodimg.bin /tmp/bad.json
