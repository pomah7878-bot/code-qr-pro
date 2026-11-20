#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const set = (k, v) => db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
set('ai_max_tokens', '600');
set('ai_free_first', '1');
console.log(db.prepare(\"SELECT key, value FROM app_settings WHERE key LIKE 'ai_%' ORDER BY key\").all());
"
