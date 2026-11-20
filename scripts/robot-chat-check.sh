#!/usr/bin/env bash
# Проверяет, что ответ клиентского помощника приходит чистым текстом (без JSON-обёртки).
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
EMAIL="qa-robot-$STAMP@example.com"
TOKEN="r$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const id = db.prepare('INSERT INTO users (email, password_hash, name, role, plan) VALUES (?,?,?,?,?)')
  .run(process.argv[1], salt + ':' + hash, 'QA Robot', 'user', 'premium').lastInsertRowid;
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now','+30 days'))\").run(id);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[2], crypto.randomBytes(16).toString('hex'), id, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log(id);
" "$EMAIL" "$TOKEN" > /tmp/robot-uid.txt
UID_=$(cat /tmp/robot-uid.txt)

echo "== вопрос =="
curl -sS -X POST "$BASE/api/assistant/chat" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"message":"Код не читается сканером, что проверить?","page":"labels"}' -o /tmp/robot-ans.json -w 'chat: %{http_code}\n'

node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/robot-ans.json', 'utf8'));
const a = String(d.answer || '');
console.log(JSON.stringify({
  startsWithJson: a.trim().startsWith('{\"'),
  length: a.length,
  needHuman: d.needHuman,
  clarify: d.clarify,
  preview: a.replace(/\s+/g, ' ').slice(0, 300)
}, null, 1));
"

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const id = Number(process.argv[1]);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
db.prepare('DELETE FROM rate_limits WHERE key IN (?,?)').run('ai-support:u' + id, 'ai-ticket:u' + id);
db.prepare('DELETE FROM users WHERE id=?').run(id);
console.log('cleanup done');
" "$UID_"
rm -f /tmp/robot-ans.json /tmp/robot-uid.txt
