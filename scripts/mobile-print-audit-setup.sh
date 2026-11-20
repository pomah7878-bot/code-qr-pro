#!/usr/bin/env bash
# Готовит премиум-пользователя и сессию для аудита мобильной печати.
set -uo pipefail
cd /opt/code-qr/server

STAMP=$(date +%s)
EMAIL="qa-mobile-print-$STAMP@example.com"
TOKEN="m$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const id = db.prepare('INSERT INTO users (email, password_hash, name, role, plan) VALUES (?,?,?,?,?)')
  .run(process.argv[1], salt + ':' + hash, 'QA Mobile Print', 'user', 'premium').lastInsertRowid;
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now','+30 days'))\").run(id);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[2], crypto.randomBytes(16).toString('hex'), id, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log('USER_ID=' + id);
" "$EMAIL" "$TOKEN"

echo "EMAIL=$EMAIL"
echo "TOKEN=$TOKEN"
