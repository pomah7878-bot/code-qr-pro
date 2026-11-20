#!/usr/bin/env bash
# Готовит админа и клиента (с историей входов и API-ключом) для UI-проверки.
set -uo pipefail
cd /opt/code-qr/server
STAMP=$(date +%s)
ADMIN_EMAIL="qa-ui7-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-ui7-client-$STAMP@example.com"
TOKEN="u$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const mk = (email, role, name) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
  return db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
    .run(email, salt + ':' + hash, name, role).lastInsertRowid;
};
const adminId = mk(process.argv[1], 'admin', 'QA admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user', 'QA клиент');
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa-ui');
db.prepare(\"INSERT INTO login_events (user_id, email, ok, reason, ip, user_agent) VALUES (?,?,?,?,?,?)\").run(clientId, process.argv[2], 1, 'password', '10.1.1.1', 'qa');
db.prepare(\"INSERT INTO login_events (user_id, email, ok, reason, ip, user_agent) VALUES (?,?,?,?,?,?)\").run(clientId, process.argv[2], 0, 'bad_password', '10.1.1.2', 'qa');
db.prepare('INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES (?,?,?,?)').run(clientId, 'QA key', 'qa', 'hash-' + process.argv[3]);
console.log('TOKEN=' + process.argv[3]);
console.log('CLIENT_ID=' + clientId);
console.log('ADMIN_EMAIL=' + process.argv[1]);
console.log('CLIENT_EMAIL=' + process.argv[2]);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$TOKEN"
