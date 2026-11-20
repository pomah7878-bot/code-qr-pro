#!/usr/bin/env bash
# Проверяем, можно ли ходить в ЧЗ True API через openssl s_client с ГОСТ-движком.
set -uo pipefail
HOST="api.mdlp.crpt.ru"
PATH_REQ="/api/v3/true-api/cises/info"
BODY='[]'
LEN=${#BODY}

REQ=$(printf 'POST %s HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' "$PATH_REQ" "$HOST" "$LEN" "$BODY")

echo "== s_client request (GOST2012) =="
printf '%s' "$REQ" | timeout 20 openssl s_client -engine gost -quiet -ign_eof \
  -connect "$HOST:443" -servername "$HOST" \
  -cipher GOST2012-KUZNYECHIK-KUZNYECHIKOMAC -tls1_2 2>/tmp/sclient.err > /tmp/sclient.out || true

echo "--- stderr ---"; tail -3 /tmp/sclient.err 2>/dev/null || true
echo "--- response (первые 600 байт) ---"
head -c 600 /tmp/sclient.out; echo
echo "--- заголовки ---"
grep -a -E '^HTTP/|^Content-Type|^Content-Length' /tmp/sclient.out | head -5 || true
