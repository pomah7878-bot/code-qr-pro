#!/usr/bin/env bash
# Временный premium-пользователь + активная подписка + сессия — напрямую в БД.
# Нужно для автотестов: биллинг-свипер снимает premium без активной подписки.
set -uo pipefail
cd /opt/code-qr/server
EMAIL="mob-$(date +%s)@example.com"
node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)')
  .run(process.argv[1], salt + ':' + hash, 'Mobile test');
const id = info.lastInsertRowid;
db.prepare(\"UPDATE users SET plan='premium' WHERE id=?\").run(id);
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now', '+3 days'))\").run(id);
const token = crypto.randomBytes(32).toString('hex');
const publicId = crypto.randomBytes(16).toString('hex');
const expires = new Date(Date.now() + 86400_000).toISOString();
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(token, publicId, id, expires, '127.0.0.1', 'autotest');
console.log('EMAIL=' + process.argv[1]);
console.log('TOKEN=' + token);
console.log('ID=' + id);
" "$EMAIL"
