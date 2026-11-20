#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log('logs before cleanup:', db.prepare('SELECT COUNT(*) c FROM app_logs').get().c);
db.prepare('DELETE FROM app_logs').run();
console.log('logs after cleanup:', db.prepare('SELECT COUNT(*) c FROM app_logs').get().c);
console.log('open tickets:', db.prepare(\"SELECT COUNT(*) c FROM support_tickets WHERE status='open'\").get().c);
"
