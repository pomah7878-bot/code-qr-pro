#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log(JSON.stringify(db.prepare('SELECT id,level,source,event,message,status,created_at FROM app_logs ORDER BY id').all(), null, 1));
"
