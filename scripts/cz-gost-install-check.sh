#!/usr/bin/env bash
# Ставим ГОСТ-движок OpenSSL и проверяем TLS-соединение с api.mdlp.crpt.ru.
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "== установка libengine-gost-openssl =="
apt-get install -y -qq libengine-gost-openssl 2>&1 | tail -3

echo "== openssl engines =="
openssl engine 2>&1 | head -12

echo "== ГОСТ-шифры =="
openssl ciphers -engine gost -v 'ALL:@SECLEVEL=0' 2>&1 | grep -i gost | head -10 || true

echo "== handshake с ГОСТ 2012 =="
for CIPHER in "GOST2012-KUZNYECHIK-KUZNYECHIKOMAC" "GOST2012-MAGMA-MAGMAOMAC" "GOST2001-GOST89-GOST89" "PROV-GOST-1D43D9D4"; do
  echo "--- $CIPHER ---"
  timeout 10 openssl s_client -engine gost -connect api.mdlp.crpt.ru:443 -servername api.mdlp.crpt.ru \
    -cipher "$CIPHER" -tls1_2 </dev/null 2>&1 | grep -E 'Cipher is|Protocol|alert|error' | head -3 || true
done

echo "== curl ciphers =="
/usr/bin/curl --version | head -2
curl --engine gost -sS -m 10 -o /dev/null -w 'curl gost ALL: %{http_code}\n' --tlsv1.2 --ciphers 'ALL:@SECLEVEL=0' \
  https://api.mdlp.crpt.ru/api/v3/true-api/cises/info -X POST -H 'Content-Type: application/json' -d '[]' 2>&1 | tail -2 || true
