#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const rows = db.prepare(\"SELECT id, email FROM users WHERE email LIKE 'qa-mobile-print%' OR email LIKE 'ios-test-%'\").all();
for (const u of rows) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM ai_queries WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM rate_limits WHERE key LIKE ?').run('%u' + u.id + '%');
  db.prepare('DELETE FROM support_tickets WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
}
console.log('removed qa users:', rows.length);
console.log('left qa users:', db.prepare(\"SELECT COUNT(*) c FROM users WHERE email LIKE 'qa-%' OR email LIKE 'ios-test-%'\").get().c);
console.log('open tickets:', db.prepare(\"SELECT COUNT(*) c FROM support_tickets WHERE status='open'\").get().c);
"
