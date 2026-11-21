#!/usr/bin/env bash
# Откат миграции (запускать НА СТАРОМ сервере, если новый не поднялся).
# Поднимает старое приложение обратно; DNS возвращать на 2.27.86.180 вручную.
set -euo pipefail
systemctl start code-qr
sleep 3
systemctl is-active code-qr
curl -sS -m 10 http://127.0.0.1:3100/api/health
echo
echo "ROLLBACK_OK old app running; верните A-запись на 2.27.86.180"
