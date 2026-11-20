#!/usr/bin/env bash
# Проверяет, что AI сначала идёт в бесплатные Kilo-модели, и токены аккаунта не тратятся.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-free-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-free-client-$STAMP@example.com"
TOKEN="f$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (email, role, name) => db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(email, salt + ':' + hash, name, role).lastInsertRowid;
const adminId = mk(process.argv[1], 'admin', 'QA free admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user', 'Ирина Петрова');
db.prepare(\"INSERT INTO login_attempts (email, fails, window_start, locked_until, last_at) VALUES (?, 5, datetime('now'), datetime('now','+10 minutes'), datetime('now'))\").run(process.argv[2]);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
const set = (k, v) => db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
set('ai_free_first', '1');
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$CLIENT_EMAIL")

echo "== settings =="
curl -sS "$BASE/api/admin/ai/settings" -H "Cookie: cq_session=$TOKEN"; echo

echo "== ask (free first) =="
time curl -sS -X POST "$BASE/api/admin/ai/ask" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"userId\":$CLIENT_ID,\"question\":\"Клиент не может войти, что делать?\"}" -o /tmp/ai-free.json -w 'ask: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/ai-free.json', 'utf8'));
console.log(JSON.stringify({
  model: d.model,
  free: String(d.model || '').startsWith('free:') || d.backend === 'kilo-free',
  error: d.error || null,
  diagnosis: String(d.diagnosis || '').slice(0, 140),
  steps: d.steps?.length || 0,
  actions: d.actions || [],
  durationMs: d.durationMs
}, null, 1));
"

echo "== draft (free first) =="
curl -sS -X POST "$BASE/api/admin/ai/draft-message" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"userId\":$CLIENT_ID,\"note\":\"Разблокировали вход\"}" -o /tmp/ai-free-draft.json -w 'draft: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/ai-free-draft.json', 'utf8'));
console.log(JSON.stringify({
  model: d.model,
  free: String(d.model || '').startsWith('free:'),
  error: d.error || null,
  subject: d.subject,
  textLength: (d.text || '').length,
  durationMs: d.durationMs
}, null, 1));
"

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of process.argv.slice(1).map(Number)) {
  db.prepare('DELETE FROM ai_queries WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_attempts WHERE email IN (SELECT email FROM users WHERE id=?)').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
" "$ADMIN_ID" "$CLIENT_ID"
rm -f /tmp/ai-free.json /tmp/ai-free-draft.json
