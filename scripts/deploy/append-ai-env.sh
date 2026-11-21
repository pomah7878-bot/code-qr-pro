#!/usr/bin/env bash
# Прописывает настройки AI-relay в .env нового сервера и перезапускает приложение.
set -euo pipefail
TOKEN="${1:?need token}"
ENV=/opt/code-qr/server/.env
grep -q '^KILO_BASE_URL=' "$ENV" || printf '\n# Free AI models via relay on old UK host (RU server gets 403 directly)\nKILO_BASE_URL=http://127.0.0.1:3110/kilo\n' >> "$ENV"
grep -q '^KILO_RELAY_TOKEN=' "$ENV" || printf 'KILO_RELAY_TOKEN=%s\n' "$TOKEN" >> "$ENV"
chown codeqr:codeqr "$ENV"
chmod 600 "$ENV"
grep -E '^KILO_' "$ENV" | sed 's/=.*/=<set>/'
