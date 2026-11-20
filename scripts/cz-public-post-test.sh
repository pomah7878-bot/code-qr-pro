#!/usr/bin/env bash
# Настоящий формат запроса из MarkScanner: POST /mobile/check {"code": "..."}
set -uo pipefail
CODE="0104638230913287215ZsWrd"
mkdir -p /tmp/czpost
printf '{"code":"%s"}' "$CODE" > /tmp/czpost/body.json

echo "== POST с сервера (OkHttp-подобные заголовки) =="
curl -4 -sS -m 20 -D /tmp/czpost/h.txt -o /tmp/czpost/b.json -w 'http: %{http_code} type: %{content_type} size: %{size_download}\n' \
  -X POST "https://mobile.api.crpt.ru/mobile/check" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -H 'Accept: application/json' \
  -H 'User-Agent: okhttp/4.9.3' \
  --data @/tmp/czpost/body.json || true
head -12 /tmp/czpost/h.txt
head -c 500 /tmp/czpost/b.json; echo

echo "== POST с browser UA =="
curl -4 -sS -m 20 -o /tmp/czpost/b2.json -w 'http: %{http_code} size: %{size_download}\n' \
  -X POST "https://mobile.api.crpt.ru/mobile/check" \
  -H 'Content-Type: application/json; charset=utf-8' -H 'Accept: application/json' \
  -H 'User-Agent: Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' \
  --data @/tmp/czpost/body.json || true
head -c 300 /tmp/czpost/b2.json; echo

echo "== POST без UA =="
curl -4 -sS -m 20 -o /tmp/czpost/b3.json -w 'http: %{http_code} size: %{size_download}\n' \
  -X POST "https://mobile.api.crpt.ru/mobile/check" \
  -H 'Content-Type: application/json; charset=utf-8' -H 'User-Agent:' \
  --data @/tmp/czpost/body.json || true
head -c 300 /tmp/czpost/b3.json; echo
