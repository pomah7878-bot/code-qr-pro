#!/usr/bin/env bash
# Проверка реальной отправки письма клиенту: пишем на собственный адрес сайта.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-mail-admin-$STAMP@example.com"
ADMIN_TOKEN="m$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

FROM=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');const r=db.prepare(\"SELECT value FROM app_settings WHERE key='smtp_from_email'\").get();console.log(r?r.value:'')")
echo "from address: $FROM"
if [ -z "$FROM" ]; then echo 'нет smtp_from_email — пропуск'; exit 0; fi

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const mk = (email, role, name) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
  const info = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
    .run(email, salt + ':' + hash, name, role);
  return info.lastInsertRowid;
};
const adminId = mk(process.argv[1], 'admin', 'qa-mail-admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user', 'Проверка почты');
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now','+5 days'))\").run(clientId);
db.prepare(\"UPDATE users SET plan='premium' WHERE id=?\").run(clientId);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
" "$ADMIN_EMAIL" "$FROM" "$ADMIN_TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$FROM")

echo "== send template letter =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/message" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"template":"access_restored"}' -w ' [%{http_code}]'; echo

echo "== compensate (with notify) =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/compensate" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"days":2,"reason":"QA проверка почты"}' -w ' [%{http_code}]'; echo

echo "== mail errors in journal =="
curl -sS "$BASE/api/admin/logs?days=1&q=%D0%BF%D0%B8%D1%81%D1%8C%D0%BC%D0%BE" -H "Cookie: cq_session=$ADMIN_TOKEN" | head -c 400; echo

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of [process.argv[1], process.argv[2]]) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_events WHERE user_id=?').run(id);
  db.prepare('DELETE FROM view_sessions WHERE user_id=? OR admin_id=?').run(id, id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
db.prepare(\"DELETE FROM app_logs WHERE message LIKE '%QA проверка почты%' OR message LIKE '%qa_mail%'\").run();
console.log('cleanup done');
" "$ADMIN_ID" "$CLIENT_ID"
