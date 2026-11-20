#!/usr/bin/env bash
# Проверяет, что предпросмотр письма на проде использует новый логотип.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
STAMP=$(date +%s)
EMAIL="qa-logo-admin-$STAMP@example.com"
TOKEN="l$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const info = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(process.argv[1], salt + ':' + hash, 'qa-logo-admin', 'admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(info.lastInsertRowid);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[2], crypto.randomBytes(16).toString('hex'), info.lastInsertRowid, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
const client = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)')
  .run('qa-logo-client-' + Date.now() + '@example.com', salt + ':' + hash, 'QA logo');
console.log('ADMIN_ID=' + info.lastInsertRowid);
console.log('CLIENT_ID=' + client.lastInsertRowid);
" "$EMAIL" "$TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare(\"SELECT id FROM users WHERE email LIKE 'qa-logo-client-%' ORDER BY id DESC LIMIT 1\").get().id)")

curl -sS "$BASE/api/admin/users/$CLIENT_ID/mail-preview?template=access_restored" -H "Cookie: cq_session=$TOKEN" -o /tmp/logo-preview.json -w 'preview: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/logo-preview.json', 'utf8'));
const html = String(d.html || '');
console.log(JSON.stringify({
  subject: d.subject,
  emailLogo: html.includes('/email-logo.png'),
  oldLogo: html.includes('/icon-192.png'),
  bytes: Buffer.byteLength(html)
}));
"

node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of process.argv.slice(1).map(Number)) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
" "$ADMIN_ID" "$CLIENT_ID"
rm -f /tmp/logo-preview.json
