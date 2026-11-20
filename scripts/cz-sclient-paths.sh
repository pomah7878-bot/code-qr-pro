#!/usr/bin/env bash
# Перебираем пути True API через ГОСТ-туннель (openssl s_client) и смотрим HTTP-статусы.
set -uo pipefail
HOST="api.mdlp.crpt.ru"

probe() {
  local method="$1" path="$2" body="${3:-}"
  local len=${#body}
  local req
  if [ -n "$body" ]; then
    req=$(printf '%s %s HTTP/1.1\r\nHost: %s\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' "$method" "$path" "$HOST" "$len" "$body")
  else
    req=$(printf '%s %s HTTP/1.1\r\nHost: %s\r\nAccept: application/json\r\nConnection: close\r\n\r\n' "$method" "$path" "$HOST")
  fi
  local out
  out=$(printf '%s' "$req" | timeout 20 openssl s_client -engine gost -quiet -ign_eof \
      -connect "$HOST:443" -servername "$HOST" \
      -cipher GOST2012-KUZNYECHIK-KUZNYECHIKOMAC -tls1_2 2>/dev/null || true)
  local status
  status=$(printf '%s' "$out" | grep -a -m1 -E '^HTTP/[0-9.]+ [0-9]+' || true)
  local ctype
  ctype=$(printf '%s' "$out" | grep -a -m1 -i '^Content-Type' || true)
  printf '%-6s %-45s -> %s | %s\n' "$method" "$path" "${status:-NO RESPONSE}" "$ctype"
  printf '%s' "$out" | sed -n '/^\r$/,$p' | head -c 160 | tr '\r\n' '  '; echo
}

probe POST /api/v3/true-api/cises/info '[]'
probe POST /api/v3/true-api/cises/info/ '[]'
probe GET  /api/v3/true-api/auth/key
probe POST /api/v3/true-api/auth/key '{}'
probe GET  /api/v3/true-api/
probe POST /api/v4/true-api/product/info '{}'
probe GET  /api/v3/true-api/cises/info
