#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log('ai settings:', db.prepare(\"SELECT key, value FROM app_settings WHERE key LIKE 'ai_%' ORDER BY key\").all());
"
A=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /opt/code-qr/web/dist/index.html | head -1)
echo "asset: $A"
echo -n 'bundle has «Спросить ИИ»: '
grep -c 'Спросить ИИ' "/opt/code-qr/web/dist/$A" || true
