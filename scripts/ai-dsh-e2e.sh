#!/usr/bin/env bash
# E2E: AI-РїРѕРјРѕС‰РЅРёРє С‡РµСЂРµР· DSH headless РЅР° СЃРµСЂРІРµСЂРµ (СЂРµР°Р»СЊРЅС‹Р№ РІС‹Р·РѕРІ РјРѕРґРµР»Рё).
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-dsh-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-dsh-client-$STAMP@example.com"
TOKEN="d$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (email, role, name) => db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(email, salt + ':' + hash, name, role).lastInsertRowid;
const adminId = mk(process.argv[1], 'admin', 'QA DSH admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user', 'QA DSH client');
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
db.prepare(\"INSERT INTO login_attempts (email, fails, window_start, locked_until, last_at) VALUES (?, 5, datetime('now'), datetime('now','+10 minutes'), datetime('now'))\").run(process.argv[2]);
const set = (k, v) => db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
set('ai_enabled', '1');
set('ai_backend', 'dsh');
set('ai_base_url', 'https://api.deepseek.com/v1');
set('ai_model', 'deepseek-chat');
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$CLIENT_EMAIL")

echo "== service env check (DSH_HOME / key length) =="
pid=$(systemctl show -p MainPID --value code-qr)
tr '\0' '\n' < "/proc/$pid/environ" | grep -E '^(DSH_HOME|HOME)=' || true
tr '\0' '\n' < "/proc/$pid/environ" | awk -F= '/^DEEPSEEK_API_KEY=/ { print "DEEPSEEK_API_KEY length=" length($2) }'

echo "== ask via dsh backend (РјРѕР¶РµС‚ Р·Р°РЅСЏС‚СЊ РґРѕ 90 СЃРµРєСѓРЅРґ) =="
time curl -sS -X POST "$BASE/api/admin/ai/ask" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"userId\":$CLIENT_ID,\"question\":\"РљР»РёРµРЅС‚ РЅРµ РјРѕР¶РµС‚ РІРѕР№С‚Рё, С‡С‚Рѕ РїСЂРѕРІРµСЂРёС‚СЊ Рё С‡С‚Рѕ СЃРґРµР»Р°С‚СЊ?\"}" -o /tmp/ai-dsh.json -w 'ask: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/ai-dsh.json', 'utf8'));
console.log(JSON.stringify({
  backend: d.backend,
  model: d.model,
  error: d.error || null,
  diagnosis: String(d.diagnosis || '').slice(0, 200),
  steps: d.steps?.length || 0,
  actions: d.actions || [],
  draft: String(d.draft || '').slice(0, 120),
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
rm -f /tmp/ai-dsh.json
