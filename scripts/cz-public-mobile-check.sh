#!/usr/bin/env bash
# Публичный (без токена) эндпоинт мобильного приложения ЧЗ — проверяем с сервера.
set -uo pipefail
UA_APP="Chestnyznak/4.47.0 (chestnyznak-mcp)"
UA_ANDROID="Chestnyznak/4.47.0 (Linux; Android 13)"
CODE="0104638230913287215ZsWrd"

for UA in "$UA_APP" "$UA_ANDROID" "Dalvik/2.1.0 (Linux; U; Android 13)"; do
  echo "===== UA: $UA ====="
  curl -4 -sS -m 15 -A "$UA" -H 'Accept: application/json' \
    "https://mobile.api.crpt.ru/mobile/check?code=${CODE}&codeType=datamatrix" \
    -o /tmp/czpub.json -w 'http: %{http_code} type: %{content_type} size: %{size_download}\n' || true
  head -c 700 /tmp/czpub.json 2>/dev/null; echo; echo
done
rm -f /tmp/czpub.json
