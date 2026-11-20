#!/usr/bin/env bash
# Проверяет /api/admin/ai/usage: миграция v25, бесплатные модели, баланс DeepSeek, статистика.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-usage-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-usage-client-$STAMP@example.com"
TOKEN="u$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
console.log('user_version:', db.pragma('user_version', { simple: true }));
const cols = db.prepare('PRAGMA table_info(ai_queries)').all().map((c) => c.name);
console.log('ai_queries cols:', cols.join(','));
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (email, role, name) => db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(email, salt + ':' + hash, name, role).lastInsertRowid;
const adminId = mk(process.argv[1], 'admin', 'QA usage admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user', 'QA usage client');
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$CLIENT_EMAIL")

echo "== один AI-запрос (чтобы появилась статистика) =="
curl -sS -X POST "$BASE/api/admin/ai/ask" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"userId\":$CLIENT_ID,\"question\":\"Проверь аккаунт\"}" -o /tmp/usage-ask.json -w 'ask: %{http_code}\n'

echo "== usage =="
curl -sS "$BASE/api/admin/ai/usage" -H "Cookie: cq_session=$TOKEN" -o /tmp/usage.json -w 'usage: %{http_code}\n'
node -e "
const fs = require('node:fs');
const u = JSON.parse(fs.readFileSync('/tmp/usage.json', 'utf8'));
console.log(JSON.stringify({
  free: { models: u.free.models, available: u.free.available, today: u.free.today },
  account: {
    backend: u.account.backend,
    balance: u.account.balance,
    today: u.account.today,
    avgTokens: u.account.avgTokens,
    estimatedQueries: u.account.estimatedQueries
  },
  lastHour: u.lastHour
}, null, 1));
"

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of process.argv.slice(1).map(Number)) {
  db.prepare('DELETE FROM ai_queries WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
" "$ADMIN_ID" "$CLIENT_ID"
rm -f /tmp/usage-ask.json /tmp/usage.json
