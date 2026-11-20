#!/usr/bin/env bash
# Удаляет тестовых пользователей, созданных автотестами (ios-test-*, ios-ui-*, mob-*).
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const like = [\"'ios-test-%'\", \"'ios-ui-%'\", \"'mob-%'\"].join(',');
const rows = db.prepare('SELECT id, email FROM users WHERE email LIKE ' + like.replace(/,/g, ' OR email LIKE ')).all();
for (const r of rows) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM users WHERE id=?').run(r.id);
  console.log('removed', r.id, r.email);
}
console.log('total removed:', rows.length);
"
