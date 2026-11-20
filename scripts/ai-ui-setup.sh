#!/usr/bin/env bash
# Поднимает мок LLM и временного админа для UI-проверки AI-помощника.
set -uo pipefail
cd /opt/code-qr/server

MOCK_SAVE_PROMPT=/tmp/ai-prompt-ui.txt node /tmp/mock-llm.mjs > /tmp/mock-llm-ui.log 2>&1 &
echo "MOCK_PID=$!"
sleep 1

node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const set = (k, v) => db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
set('ai_enabled', '1');
set('ai_backend', 'api');
set('ai_base_url', 'http://127.0.0.1:8099/v1');
set('ai_model', 'mock-model');
set('ai_api_key', 'mock-key');
console.log('ai configured for UI test');
"

bash /tmp/mk-admin7-ui-test.sh
