#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const v = db.pragma('user_version', { simple: true });
const t = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='ai_queries'\").get();
console.log(JSON.stringify({ version: v, ai_queries: Boolean(t) }));
"
