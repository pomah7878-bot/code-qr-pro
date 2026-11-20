#!/usr/bin/env bash
# Готовит премиум-клиента и админа для UI-проверки клиентского помощника и поддержки.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
CLIENT_EMAIL="qa-help-client-$STAMP@example.com"
ADMIN_EMAIL="qa-help-admin-$STAMP@example.com"
TOKEN_C="c$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
TOKEN_A="a$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (email, name, role, plan) => db.prepare('INSERT INTO users (email, password_hash, name, role, plan) VALUES (?,?,?,?,?)')
  .run(email, salt + ':' + hash, name, role, plan).lastInsertRowid;
const client = mk(process.argv[1], 'Мария Петрова', 'user', 'premium');
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now','+30 days'))\").run(client);
const admin = mk(process.argv[2], 'QA help admin', 'admin', 'free');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(admin);
const sess = (token, uid) => db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(token, crypto.randomBytes(16).toString('hex'), uid, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
sess(process.argv[3], client);
sess(process.argv[4], admin);
console.log('CLIENT_ID=' + client);
console.log('ADMIN_ID=' + admin);
" "$CLIENT_EMAIL" "$ADMIN_EMAIL" "$TOKEN_C" "$TOKEN_A"

echo "TOKEN_C=$TOKEN_C"
echo "TOKEN_A=$TOKEN_A"

echo "== создаём обращение от клиента =="
curl -sS -X POST "$BASE/api/assistant/tickets" -H "Cookie: cq_session=$TOKEN_C" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"subject":"Сканер не читает DataMatrix с этикетки 40x30","message":"Печатаю на термопринтере 40x30, приложение сканера не находит код. Что проверить?","aiContext":"Проверьте размер модуля (не меньше 0,4 мм), контраст и печать без масштабирования."}' -w ' [%{http_code}]\n'
