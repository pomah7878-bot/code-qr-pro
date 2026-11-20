#!/usr/bin/env bash
# Проверяет, что выход из просмотра возвращает админскую сессию.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-exit-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-exit-client-$STAMP@example.com"
ADMIN_TOKEN="e$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const mk = (email, role) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
  return db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
    .run(email, salt + ':' + hash, email.split('@')[0], role).lastInsertRowid;
};
const adminId = mk(process.argv[1], 'admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user');
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$ADMIN_TOKEN"

CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$CLIENT_EMAIL")

VIEW=$(curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/impersonate" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}')
VIEW_URL=$(node -e "try{console.log(JSON.parse(process.argv[1]).url||'')}catch(e){console.log('')}" "$VIEW")
VIEW_TOKEN=$(node -e "console.log((process.argv[1]||'').split('/').pop())" "$VIEW_URL")

echo -n 'view mode: '
curl -sS "$BASE/api/me" -H "Cookie: cq_session=$ADMIN_TOKEN; cq_view=$VIEW_TOKEN" | head -c 200; echo

echo -n 'exit: '
curl -sS -X POST "$BASE/api/auth/view/exit" -H "Cookie: cq_session=$ADMIN_TOKEN; cq_view=$VIEW_TOKEN" -H "$ORIGIN" -w ' [%{http_code}]'; echo

echo -n 'back to admin: '
curl -sS "$BASE/api/me" -H "Cookie: cq_session=$ADMIN_TOKEN; cq_view=$VIEW_TOKEN" | head -c 200; echo

echo -n 'write as admin after exit: '
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/admin/users/$CLIENT_ID/note" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"note":"qa exit check"}'

node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const email of [process.argv[1], process.argv[2]]) {
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (u) {
    db.prepare('DELETE FROM view_sessions WHERE user_id=? OR admin_id=?').run(u.id, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM login_events WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  }
}
console.log('cleanup done');
" "$ADMIN_EMAIL" "$CLIENT_EMAIL"
