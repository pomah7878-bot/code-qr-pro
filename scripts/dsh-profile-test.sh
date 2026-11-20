#!/usr/bin/env bash
# Проверяет профиль ai-support (без инструментов) под пользователем сервиса.
set -uo pipefail
KEY=$(sed -n 's/^DEEPSEEK_API_KEY=//p' /opt/code-qr/server/.env)
cd /tmp
sudo -u codeqr env \
  DSH_HOME=/opt/code-qr/server/data/dsh-home \
  HOME=/opt/code-qr \
  DEEPSEEK_API_KEY="$KEY" \
  PATH=/usr/local/bin:/usr/bin:/bin \
  timeout 120 /usr/local/bin/dsh --profile ai-support --approval-policy never --permission-mode read-only \
  'Answer with compact JSON only: {"ok":true}' 2>&1 | tail -8
