#!/usr/bin/env bash
# Убирает тестовые данные клиентского помощника (qa-* пользователи и их обращения).
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const ids = db.prepare(\"SELECT id FROM users WHERE email LIKE 'qa-%@example.com'\").all().map((r) => r.id);
for (const id of ids) {
  db.prepare('DELETE FROM support_tickets WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM rate_limits WHERE key IN (?,?)').run('ai-support:u' + id, 'ai-ticket:u' + id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
const orphans = db.prepare(\"DELETE FROM support_tickets WHERE user_id NOT IN (SELECT id FROM users)\").run().changes;
console.log(JSON.stringify({ users: ids.length, orphanTickets: orphans, ticketsLeft: db.prepare('SELECT COUNT(*) c FROM support_tickets').get().c, kb: db.prepare('SELECT COUNT(*) c FROM kb_articles').get().c }));
"
