#!/usr/bin/env bash
# Деплой CODE QR PRO (этап 1). Запускать на сервере из /opt/code-qr.
set -euo pipefail
cd /opt/code-qr/server
npm install --omit=dev --no-audit --no-fund
install -m 644 /opt/code-qr/deploy/code-qr.service /etc/systemd/system/code-qr.service
systemctl daemon-reload
systemctl enable --now code-qr.service
install -m 644 /opt/code-qr/deploy/nginx-code-qr.conf /etc/nginx/sites-available/code-qr.stockcity.ru.conf
ln -sf /etc/nginx/sites-available/code-qr.stockcity.ru.conf /etc/nginx/sites-enabled/code-qr.stockcity.ru.conf
nginx -t
systemctl reload nginx
echo "--- health ---"
sleep 2
curl -sS http://127.0.0.1:3100/api/health
echo
echo "--- ECLIPSE still alive ---"
curl -sS -o /dev/null -w "eclipse: HTTP %{http_code}\n" https://eclipse.unlimited.bot.nu/
