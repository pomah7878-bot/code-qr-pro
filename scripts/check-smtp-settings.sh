#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const rows = db.prepare(\"SELECT key, length(value) AS len FROM app_settings WHERE key LIKE 'smtp_%' OR key LIKE 'public_%'\").all();
console.log('settings:', JSON.stringify(rows));
console.log('version:', db.pragma('user_version', { simple: true }));
"
