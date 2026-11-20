#!/usr/bin/env bash
# Проверяем True API на markirovka.crpt.ru (обычный TLS) — базовый URL из документации.
set -uo pipefail
UA="CODE-QR-PRO/1.0"
for BASE in "https://markirovka.crpt.ru/api/v3/true-api" "https://markirovka.sandbox.crptech.ru/api/v3/true-api"; do
  echo "===== $BASE ====="
  echo -n 'GET  /auth/key: '
  curl -4 -sS -m 10 -A "$UA" -o /tmp/cz1.json -w '%{http_code}\n' "$BASE/auth/key" || true
  head -c 160 /tmp/cz1.json 2>/dev/null; echo

  echo -n 'POST /cises/info (без токена): '
  curl -4 -sS -m 10 -A "$UA" -o /tmp/cz2.json -w '%{http_code} %{content_type}\n' \
    -X POST "$BASE/cises/info" -H 'Content-Type: application/json' -d '[]' || true
  head -c 200 /tmp/cz2.json 2>/dev/null; echo

  echo -n 'POST /cises/info (фейковый токен): '
  curl -4 -sS -m 10 -A "$UA" -o /tmp/cz3.json -w '%{http_code} %{content_type}\n' \
    -X POST "$BASE/cises/info" -H 'Content-Type: application/json' -H 'Authorization: Bearer test-token-invalid' -d '[]' || true
  head -c 200 /tmp/cz3.json 2>/dev/null; echo

  echo -n 'POST /product/info (v4, фейковый токен): '
  curl -4 -sS -m 10 -A "$UA" -o /tmp/cz4.json -w '%{http_code} %{content_type}\n' \
    -X POST "${BASE%/api/v3/true-api}/api/v4/true-api/product/info" -H 'Content-Type: application/json' -H 'Authorization: Bearer test-token-invalid' -d '[]' || true
  head -c 200 /tmp/cz4.json 2>/dev/null; echo
done
rm -f /tmp/cz1.json /tmp/cz2.json /tmp/cz3.json /tmp/cz4.json
