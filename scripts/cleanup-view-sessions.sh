#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const r = db.prepare('DELETE FROM view_sessions WHERE user_id NOT IN (SELECT id FROM users) OR admin_id NOT IN (SELECT id FROM users)').run();
console.log('stale view sessions removed:', r.changes);
console.log('left:', db.prepare('SELECT COUNT(*) c FROM view_sessions').get().c);
"
