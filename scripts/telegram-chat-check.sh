#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' .env)
CHAT=$(sed -n 's/^TELEGRAM_ADMIN_ID=//p' .env)

echo "== chat доступен боту =="
curl -4 -sS -m 10 "https://api.telegram.org/bot${TOKEN}/getChat?chat_id=${CHAT}" -o /tmp/tg-chat.json -w 'getChat: %{http_code} ip: %{remote_ip}\n' || true
node -e "
const fs = require('node:fs');
try {
  const d = JSON.parse(fs.readFileSync('/tmp/tg-chat.json', 'utf8'));
  console.log(JSON.stringify({ ok: d.ok, type: d.result?.type, username: d.result?.username || d.result?.first_name || null, error: d.description || null }));
} catch (e) { console.log('parse error', e.message); }
"
rm -f /tmp/tg-chat.json

echo "== journal: ошибки telegram за 10 минут =="
journalctl -u code-qr --since '-10 min' --no-pager | grep -i 'telegram notify' | tail -3 || echo 'ошибок нет'
