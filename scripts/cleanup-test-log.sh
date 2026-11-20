#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
db.prepare(\"DELETE FROM app_logs WHERE event LIKE 'FST_ERR_CTP_INVALID_MEDIA_TYPE'\").run();
console.log('logs left:', db.prepare('SELECT COUNT(*) c FROM app_logs').get().c);
"
systemctl restart code-qr
sleep 4
systemctl is-active code-qr
curl -sS https://code-qr.stockcity.ru/api/health
echo
