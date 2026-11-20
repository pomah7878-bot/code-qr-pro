#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server

echo "== создаём тестовое обращение и смотрим Telegram =="
bash /tmp/ai-support-ui-setup.sh
sleep 4

echo "== journal: ошибки telegram за 5 минут =="
journalctl -u code-qr --since '-5 min' --no-pager | grep -i 'telegram notify' | tail -3 || echo 'ошибок нет'

echo "== app_logs: события notify =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const rows = db.prepare(\"SELECT id, level, source, event, message, created_at FROM app_logs WHERE source='notify' OR event LIKE '%telegram%' ORDER BY id DESC LIMIT 5\").all();
console.log(JSON.stringify(rows, null, 1));
console.log('open tickets:', db.prepare(\"SELECT COUNT(*) c FROM support_tickets WHERE status='open'\").get().c);
"
