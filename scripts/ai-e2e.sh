#!/usr/bin/env bash
# E2E AI-помощника админки: мок LLM, реальные настройки, запрос «Спросить ИИ».
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-ai-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-ai-client-$STAMP@example.com"
TOKEN="i$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

echo "== start mock llm =="
MOCK_SAVE_PROMPT=/tmp/ai-prompt.txt node /tmp/mock-llm.mjs > /tmp/mock-llm.log 2>&1 &
MOCK_PID=$!
sleep 1
curl -sS -o /dev/null -w 'mock: %{http_code}\n' -X POST http://127.0.0.1:8099/v1/chat/completions -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"test"}]}'

echo "== users =="
node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (email, role, name) => db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(email, salt + ':' + hash, name, role).lastInsertRowid;
const adminId = mk(process.argv[1], 'admin', 'QA AI admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user', 'QA AI client');
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
db.prepare(\"INSERT INTO login_attempts (email, fails, window_start, locked_until, last_at) VALUES (?, 5, datetime('now'), datetime('now','+10 minutes'), datetime('now'))\").run(process.argv[2]);
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(clientId);
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$CLIENT_EMAIL")

echo "== configure ai (mock) =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const set = (k, v) => db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
set('ai_enabled', '1');
set('ai_backend', 'api');
set('ai_base_url', 'http://127.0.0.1:8099/v1');
set('ai_model', 'mock-model');
set('ai_api_key', 'mock-key');
set('ai_max_tokens', '700');
console.log('ai settings saved');
"

echo "== settings via api =="
curl -sS "$BASE/api/admin/ai/settings" -H "Cookie: cq_session=$TOKEN"; echo

echo "== test provider =="
curl -sS -X POST "$BASE/api/admin/ai/test" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -w ' [%{http_code}]'; echo

echo "== ask =="
curl -sS -X POST "$BASE/api/admin/ai/ask" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"userId\":$CLIENT_ID,\"question\":\"Клиент не может войти, 2FA включена, телефон потерял\"}" -o /tmp/ai-ask.json -w 'ask: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/ai-ask.json', 'utf8'));
console.log(JSON.stringify({
  diagnosis: (d.diagnosis || '').slice(0, 90),
  steps: d.steps?.length,
  actions: d.actions,
  draft: Boolean(d.draft),
  confidence: d.confidence,
  model: d.model,
  backend: d.backend,
  durationMs: d.durationMs
}));
"
echo "== prompt contains facts =="
grep -c 'Пользователь #' /tmp/ai-prompt.txt 2>/dev/null || echo 'no prompt'
head -c 400 /tmp/ai-prompt.txt 2>/dev/null; echo

echo "== history =="
curl -sS "$BASE/api/admin/ai/history?userId=$CLIENT_ID" -H "Cookie: cq_session=$TOKEN" | head -c 300; echo

echo "== cleanup =="
kill $MOCK_PID 2>/dev/null || true
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of process.argv.slice(1).map(Number)) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_events WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_attempts WHERE email IN (SELECT email FROM users WHERE id=?)').run(id);
  db.prepare('DELETE FROM ai_queries WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
for (const k of ['ai_api_key','ai_base_url','ai_model','ai_max_tokens','ai_backend','ai_enabled']) {
  db.prepare('DELETE FROM app_settings WHERE key=?').run(k);
}
console.log('cleanup done');
" "$ADMIN_ID" "$CLIENT_ID"
rm -f /tmp/ai-ask.json /tmp/ai-prompt.txt /tmp/mock-llm.log
