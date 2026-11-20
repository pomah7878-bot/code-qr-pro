#!/usr/bin/env bash
# Проверяем, можно ли достучаться до ЧЗ True API: варианты хостов и ГОСТ-TLS.
set -uo pipefail
echo "== hosts/TLS =="
for u in https://api.mdlp.crpt.ru/api/v3/true-api/cises/info \
         https://mobile.api.crpt.ru/ \
         https://markirovka.crpt.ru/ \
         https://api.chestnyznak.ru/ \
         http://api.mdlp.crpt.ru/api/v3/true-api/cises/info; do
  curl -4 -sS -m 8 -o /dev/null -w "$u -> %{http_code} (%{time_total}s)\n" "$u" 2>&1 | tail -1 || true
done

echo "== TLS handshake to api.mdlp.crpt.ru =="
timeout 8 openssl s_client -connect api.mdlp.crpt.ru:443 -servername api.mdlp.crpt.ru </dev/null 2>&1 | grep -E 'Protocol|Cipher|Verify|error|alert' | head -6 || true

echo "== openssl engines =="
openssl engine 2>&1 | head -10 || true
echo "== gost engine packages =="
apt-cache policy libengine-gost-openssl 2>/dev/null | head -6 || true
apt-cache policy openssl-gost 2>/dev/null | head -6 || true
ls /usr/lib/x86_64-linux-gnu/engines-3/ 2>/dev/null | head -10 || true
