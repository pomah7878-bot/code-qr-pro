#!/usr/bin/env bash
# Удаляет тестовых пользователей UI-проверки раздела «Маркетплейсы» (mp-ui-*).
set -uo pipefail
cd /opt/code-qr/server
node <<'EOF'
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const rows = db.prepare("SELECT id, email FROM users WHERE email LIKE 'mp-ui-%' AND email LIKE '%@test.local'").all();
for (const r of rows) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM marketplace_documents WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM marketplace_products WHERE user_id=?').run(r.id);
  db.prepare('DELETE FROM users WHERE id=?').run(r.id);
  console.log('removed', r.id, r.email);
}
console.log('total removed:', rows.length);
EOF
