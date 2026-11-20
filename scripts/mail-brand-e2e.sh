#!/usr/bin/env bash
# Проверка фирменного шаблона: предпросмотр, реальная отправка, тест SMTP.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-brand-admin-$STAMP@example.com"
TOKEN="b$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
FROM=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');const r=db.prepare(\"SELECT value FROM app_settings WHERE key='smtp_from_email'\").get();console.log(r?r.value:'')")

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const info = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(process.argv[1], salt + ':' + hash, 'qa-brand-admin', 'admin');
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(info.lastInsertRowid);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[2], crypto.randomBytes(16).toString('hex'), info.lastInsertRowid, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
const client = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run(process.argv[3], salt + ':' + hash, 'Проверка шаблона', 'user');
console.log('ADMIN_ID=' + info.lastInsertRowid);
console.log('CLIENT_ID=' + client.lastInsertRowid);
" "$ADMIN_EMAIL" "$TOKEN" "$FROM"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$FROM")

echo "== preview (markers) =="
curl -sS "$BASE/api/admin/users/$CLIENT_ID/mail-preview?template=access_restored" -H "Cookie: cq_session=$TOKEN" -o /tmp/preview.json -w 'preview: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/preview.json', 'utf8'));
const html = String(d.html || '');
console.log(JSON.stringify({
  subject: d.subject,
  bytes: Buffer.byteLength(html),
  brand: html.includes('CODE QR PRO'),
  mark: html.includes('>QR<'),
  gradient: html.includes('linear-gradient'),
  cta: html.includes('Войти в кабинет'),
  tableLayout: html.includes('role=\"presentation\"'),
  preheader: html.includes('display:none;max-height:0')
}));
"

echo "== real send to own mailbox =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/message" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"template":"compensation","days":3,"reason":"Проверка фирменного письма"}' -w ' [%{http_code}]'; echo

echo "== smtp test email =="
curl -sS -X POST "$BASE/api/admin/settings/smtp/test" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"to\":\"$FROM\"}" -w ' [%{http_code}]'; echo

echo "== journal (mail errors) =="
curl -sS "$BASE/api/admin/logs?days=1&source=server&level=warn&q=%D0%BF%D0%B8%D1%81%D1%8C%D0%BC" -H "Cookie: cq_session=$TOKEN" | head -c 200; echo

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of [process.argv[1], process.argv[2]]) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_events WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
" "$ADMIN_ID" "$CLIENT_ID"
rm -f /tmp/preview.json
