#!/usr/bin/env bash
set -uo pipefail
echo "== telegram env =="
grep -c 'TELEGRAM' /opt/code-qr/server/.env || true
echo "== telegram errors in journal (last 20 min) =="
journalctl -u code-qr --since '-20 min' --no-pager | grep -i 'telegram' | tail -5 || echo 'no telegram errors'
echo "== tickets =="
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log(JSON.stringify(db.prepare('SELECT status, COUNT(*) c FROM support_tickets GROUP BY status').all()));
console.log('last tickets:', JSON.stringify(db.prepare('SELECT id, subject, status, created_at FROM support_tickets ORDER BY id DESC LIMIT 5').all()));
"
