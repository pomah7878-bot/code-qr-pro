#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const total = db.prepare('SELECT COUNT(*) c FROM app_logs').get().c;
const rows = db.prepare('SELECT id, level, source, event, message, status, created_at FROM app_logs ORDER BY id DESC LIMIT 40').all();
console.log('total:', total);
const byEvent = {};
for (const r of rows) byEvent[r.event] = (byEvent[r.event] || 0) + 1;
console.log('last40 by event:', JSON.stringify(byEvent));
for (const r of rows) console.log([r.id, r.created_at, r.level, r.source, r.event, String(r.message).slice(0, 110), r.status].join(' | '));
"
