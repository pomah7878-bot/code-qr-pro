#!/usr/bin/env bash
# Включает AI-помощника админки на бэкенде DSH и убирает настройки API-провайдера.
set -euo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const set = (k, v) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
set('ai_enabled', '1');
set('ai_backend', 'dsh');
db.prepare(\"DELETE FROM app_settings WHERE key IN ('ai_base_url','ai_model','ai_api_key')\").run();
console.log('ai settings:', db.prepare(\"SELECT key, value FROM app_settings WHERE key LIKE 'ai_%' ORDER BY key\").all());
"
systemctl restart code-qr
sleep 4
systemctl is-active code-qr
curl -sS https://code-qr.stockcity.ru/api/health
echo
