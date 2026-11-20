#!/usr/bin/env bash
# E2E журнала ошибок: клиентская ошибка -> админ видит запись, детали, CSV.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-log-admin-$STAMP@example.com"
TOKEN="l$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const info = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(process.argv[1], salt + ':' + hash, 'qa-log-admin', 'admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(info.lastInsertRowid);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[2], crypto.randomBytes(16).toString('hex'), info.lastInsertRowid, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa-log');
console.log('ADMIN_ID=' + info.lastInsertRowid);
" "$ADMIN_EMAIL" "$TOKEN"

echo "== db version / table =="
node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(JSON.stringify({version: db.pragma('user_version',{simple:true}), logs: db.prepare('SELECT COUNT(*) c FROM app_logs').get().c}))"

echo "== client error (public endpoint) =="
curl -sS -X POST "$BASE/api/logs/client" -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d "{\"event\":\"qa_client_error\",\"message\":\"QA: тестовая клиентская ошибка $STAMP\",\"url\":\"/qa-test\",\"route\":\"/qa-test\",\"stack\":\"Error: QA\\n  at test.js:1\"}" -w ' [%{http_code}]'; echo

echo "== admin list =="
LIST=$(curl -sS "$BASE/api/admin/logs?days=1&per=10" -H "Cookie: cq_session=$TOKEN")
echo "$LIST" | head -c 700; echo
LOG_ID=$(node -e "try{const d=JSON.parse(process.argv[1]);const r=(d.logs||[]).find(l=>l.event==='qa_client_error');console.log(r?r.id:'')}catch(e){console.log('')}" "$LIST")

if [ -n "$LOG_ID" ]; then
  echo "== detail id=$LOG_ID =="
  curl -sS "$BASE/api/admin/logs/$LOG_ID" -H "Cookie: cq_session=$TOKEN" | head -c 500; echo
fi

echo "== export csv =="
curl -sS -o /tmp/logs.csv -w 'csv: %{http_code} size=%{size_download}\n' "$BASE/api/admin/logs/export.csv?days=1" -H "Cookie: cq_session=$TOKEN"
head -c 200 /tmp/logs.csv; echo

echo "== clear old (365d) =="
curl -sS -X DELETE "$BASE/api/admin/logs" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"days":365}' -w ' [%{http_code}]'; echo

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const u = db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]);
if (u) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); db.prepare('DELETE FROM users WHERE id=?').run(u.id); }
db.prepare(\"DELETE FROM app_logs WHERE event='qa_client_error'\").run();
console.log('cleanup done');
" "$ADMIN_EMAIL"
rm -f /tmp/logs.csv
