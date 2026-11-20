#!/usr/bin/env bash
# Проверяет AI-генерацию письма клиенту (реальный DSH).
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-draft-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-draft-client-$STAMP@example.com"
TOKEN="w$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (email, role, name) => db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(email, salt + ':' + hash, name, role).lastInsertRowid;
const adminId = mk(process.argv[1], 'admin', 'QA draft admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user', 'Грачёва Ольга');
db.prepare(\"UPDATE users SET plan='premium' WHERE id=?\").run(clientId);
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now','+20 days'))\").run(clientId);
db.prepare(\"INSERT INTO login_attempts (email, fails, window_start, locked_until, last_at) VALUES (?, 5, datetime('now'), datetime('now','+10 minutes'), datetime('now'))\").run(process.argv[2]);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$CLIENT_EMAIL")

echo "== draft message (может занять до 60 секунд) =="
time curl -sS -X POST "$BASE/api/admin/ai/draft-message" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"userId\":$CLIENT_ID,\"note\":\"Клиент не мог войти, мы разблокировали вход и сбросили 2FA\"}" \
  -o /tmp/ai-draft.json -w 'draft: %{http_code}\n'

node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/ai-draft.json', 'utf8'));
console.log(JSON.stringify({
  error: d.error || null,
  subject: d.subject,
  textLength: (d.text || '').length,
  preview: (d.text || '').slice(0, 220),
  model: d.model,
  durationMs: d.durationMs
}, null, 1));
"

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of process.argv.slice(1).map(Number)) {
  db.prepare('DELETE FROM ai_queries WHERE user_id=?').run(id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_attempts WHERE email IN (SELECT email FROM users WHERE id=?)').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
" "$ADMIN_ID" "$CLIENT_ID"
rm -f /tmp/ai-draft.json
