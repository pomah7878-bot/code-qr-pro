#!/usr/bin/env bash
# Убирает тестовые записи журнала и тестовых пользователей после автотестов.
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const logs = db.prepare(\"DELETE FROM app_logs WHERE event = 'qa_client_error' OR message LIKE '%QA-browser-%' OR message LIKE '%Bad escaped character%' OR message LIKE '%QA:%'\").run();
const users = db.prepare(\"SELECT id, email FROM users WHERE email LIKE 'qa-%@example.com'\").all();
for (const u of users) {
  db.prepare('DELETE FROM login_links WHERE user_id=?').run(u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  db.prepare('DELETE FROM login_attempts WHERE email=?').run(u.email);
}
console.log(JSON.stringify({ logsRemoved: logs.changes, usersRemoved: users.length, left: db.prepare('SELECT COUNT(*) c FROM app_logs').get().c }));
"
