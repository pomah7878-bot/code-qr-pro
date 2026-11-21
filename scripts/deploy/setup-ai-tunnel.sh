#!/usr/bin/env bash
# Установка туннеля до AI-relay на новом (РФ) сервере. Запуск: bash /tmp/setup-ai-tunnel.sh <token>
set -euo pipefail
TOKEN="${1:?need relay token}"
HOST_OLD="2.27.86.180"

if [ ! -f /root/.ssh/ai_relay_ed25519 ]; then
  ssh-keygen -t ed25519 -N '' -f /root/.ssh/ai_relay_ed25519 -q
fi
chmod 600 /root/.ssh/ai_relay_ed25519

install -m 644 /tmp/ai-relay-tunnel.service /etc/systemd/system/ai-relay-tunnel.service
systemctl daemon-reload
systemctl enable --now ai-relay-tunnel
sleep 3
systemctl is-active ai-relay-tunnel

# env для приложения
ENV=/opt/code-qr/server/.env
if ! grep -q '^KILO_BASE_URL=' "$ENV"; then
  printf '\n# Free AI models via relay on old UK host (RU server gets 403 directly)\nKILO_BASE_URL=http://127.0.0.1:3110/kilo\n' >> "$ENV"
fi
if ! grep -q '^KILO_RELAY_TOKEN=' "$ENV"; then
  printf 'KILO_RELAY_TOKEN=%s\n' "$TOKEN" >> "$ENV"
fi
chown codeqr:codeqr "$ENV"
chmod 600 "$ENV"

# проверяем туннель
curl -sS -m 8 http://127.0.0.1:3110/health; echo

systemctl restart code-qr
sleep 3
systemctl is-active code-qr
echo TUNNEL_READY
