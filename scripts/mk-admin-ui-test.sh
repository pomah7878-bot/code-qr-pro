#!/usr/bin/env bash
# Готовит временного админа (с 2FA) и клиента с блокировкой входа, печатает токен и ID клиента.
set -uo pipefail
cd /opt/code-qr/server
STAMP=$(date +%s)
ADMIN_EMAIL="qa-ui-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-ui-client-$STAMP@example.com"
TOKEN="t$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const mk = (email, role) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
  const info = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
    .run(email, salt + ':' + hash, email.split('@')[0], role);
  return info.lastInsertRowid;
};
const adminId = mk(process.argv[1], 'admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user');
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa-ui');
db.prepare(\"INSERT OR REPLACE INTO login_attempts (email, fails, window_start, locked_until, last_at) VALUES (?, 5, datetime('now'), datetime('now','+10 minutes'), datetime('now'))\").run(process.argv[2]);
console.log('TOKEN=' + process.argv[3]);
console.log('CLIENT_ID=' + clientId);
console.log('ADMIN_EMAIL=' + process.argv[1]);
console.log('CLIENT_EMAIL=' + process.argv[2]);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$TOKEN"
