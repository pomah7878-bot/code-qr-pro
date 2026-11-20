#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const rows = db.prepare('SELECT id, user_id, admin_id, question, status, error, model, duration_ms, created_at FROM ai_queries ORDER BY id DESC LIMIT 8').all();
console.log(JSON.stringify(rows, null, 1));
"
