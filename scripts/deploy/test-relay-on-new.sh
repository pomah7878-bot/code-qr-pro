#!/usr/bin/env bash
# Проверка AI-relay на новом (РФ) сервере: туннель, токен, бесплатная модель.
set -uo pipefail
systemctl restart ai-relay-tunnel
sleep 2
echo "tunnel: $(systemctl is-active ai-relay-tunnel)"
echo "--- env ---"
grep -E '^KILO_' /opt/code-qr/server/.env | sed 's/=.*/=<set>/'
TOKEN="$(grep '^KILO_RELAY_TOKEN=' /opt/code-qr/server/.env | cut -d= -f2-)"
echo "--- relay via tunnel ---"
curl -4 -sS -m 40 -o /tmp/relay-test.json -w 'relay: %{http_code}\n' \
  -X POST http://127.0.0.1:3110/kilo/chat/completions \
  -H 'Content-Type: application/json' \
  -H "x-relay-token: $TOKEN" \
  --data '{"model":"kilo-auto/free","messages":[{"role":"user","content":"ответь одним словом: работает"}],"max_tokens":40,"stream":false}'
head -c 260 /tmp/relay-test.json; echo
systemctl restart code-qr
sleep 3
echo "app: $(systemctl is-active code-qr)"
