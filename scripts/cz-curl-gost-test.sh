#!/usr/bin/env bash
set -uo pipefail
URL="https://api.mdlp.crpt.ru/api/v3/true-api/cises/info"

for args in \
  "--tlsv1.2 --tls-max 1.2 --ciphers GOST2012-KUZNYECHIK-KUZNYECHIKOMAC" \
  "--tlsv1.2 --tls-max 1.2 --ciphers GOST2012-MAGMA-MAGMAOMAC" \
  "--tlsv1.2 --tls-max 1.2 --ciphers 'GOST2012-KUZNYECHIK-KUZNYECHIKOMAC:ALL:@SECLEVEL=0'" \
  "--tls-max 1.2 --ciphers GOST2012-KUZNYECHIK-KUZNYECHIKOMAC"; do
  echo "--- curl --engine gost $args ---"
  eval "curl --engine gost -k -sS -m 12 -o /tmp/czresp.json -w 'http: %{http_code}\\n' $args -X POST '$URL' -H 'Content-Type: application/json' -d '[]'" 2>&1 | tail -2
  head -c 200 /tmp/czresp.json 2>/dev/null; echo
done

echo "--- curl без seclevel, через config ---"
cat > /tmp/gost-curl.cnf <<'EOF'
openssl_conf = openssl_init
[openssl_init]
engines = engine_section
[engine_section]
gost = gost_section
[gost_section]
engine_id = gost
dynamic_path = /usr/lib/x86_64-linux-gnu/engines-3/gost.so
default_algorithms = ALL
EOF
ls -la /usr/lib/x86_64-linux-gnu/engines-3/ | head -6
