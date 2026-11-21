#!/usr/bin/env bash
# Проверка relay: health + GET /kilo/models (используется админкой).
set -uo pipefail
systemctl is-active ai-relay
TOKEN="$(grep '^RELAY_TOKEN=' /opt/ai-relay/relay.env | cut -d= -f2)"
echo "token length: ${#TOKEN}"
curl -sS -m 20 -H "x-relay-token: $TOKEN" -o /tmp/models.json -w 'models via relay: %{http_code}\n' http://127.0.0.1:3110/kilo/models
head -c 140 /tmp/models.json; echo
rm -f /tmp/models.json
