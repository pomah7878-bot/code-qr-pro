#!/usr/bin/env bash
# Удаляет тестовых пользователей автотестов (qa-*, mob-*, ios-*).
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const rows = db.prepare(\"SELECT id, email FROM users WHERE email LIKE 'qa-%@example.com' OR email LIKE 'mob-%@example.com' OR email LIKE 'ios-%@example.com'\").all();
for (const r of rows) {
  db.prepare('DELETE FROM login_links WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM usage_daily WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM users WHERE id=?').run(r.id);
  db.prepare('DELETE FROM login_attempts WHERE email=?').run(r.email);
  console.log('removed', r.id, r.email);
}
console.log('total:', rows.length);
"
