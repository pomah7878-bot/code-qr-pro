#!/usr/bin/env bash
# E2E окончания PREMIUM: отдельные адреса, проверка downgrade и писем.
set -uo pipefail
cd /opt/code-qr/server

FROM=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');const r=db.prepare(\"SELECT value FROM app_settings WHERE key='smtp_from_email'\").get();console.log(r?r.value:'')")
BASE_MAIL="${FROM%%@*}"
DOMAIN="${FROM##*@}"
SOON_MAIL="$BASE_MAIL+soon@$DOMAIN"
EXP_MAIL="$BASE_MAIL+expired@$DOMAIN"
echo "mails: $SOON_MAIL / $EXP_MAIL"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (email, name) => db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)')
  .run(email, salt + ':' + hash, name).lastInsertRowid;
const soon = mk(process.argv[1], 'QA soon');
db.prepare(\"UPDATE users SET plan='premium' WHERE id=?\").run(soon);
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now','-28 days'), datetime('now','+2 days'))\").run(soon);
const exp = mk(process.argv[2], 'QA expired');
db.prepare(\"UPDATE users SET plan='premium' WHERE id=?\").run(exp);
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now','-31 days'), datetime('now','-1 day'))\").run(exp);
console.log('SOON_ID=' + soon);
console.log('EXP_ID=' + exp);
" "$SOON_MAIL" "$EXP_MAIL"

SOON_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare(\"SELECT id FROM users WHERE email=?\").get(process.argv[1]).id)" "$SOON_MAIL")
EXP_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare(\"SELECT id FROM users WHERE email=?\").get(process.argv[1]).id)" "$EXP_MAIL")

echo "== expiring soon =="
node -e "import('./src/billing.js').then((m) => console.log('sent:', m.notifyExpiringSoon(3)))"
sleep 3

echo "== expire =="
node -e "import('./src/billing.js').then((m) => { m.expireSubscriptions(); console.log('ok'); })"
sleep 3

node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of process.argv.slice(1).map(Number)) {
  const u = db.prepare('SELECT id, email, plan, premium_notice_at FROM users WHERE id=?').get(id);
  const s = db.prepare('SELECT status, expires_at FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(id);
  console.log(JSON.stringify({ id, plan: u?.plan, notice: Boolean(u?.premium_notice_at), sub: s?.status }));
}
" "$SOON_ID" "$EXP_ID"

echo "== mail errors (10 min) =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const rows = db.prepare(\"SELECT event, message FROM app_logs WHERE source='mail' AND created_at > datetime('now','-10 minutes')\").all();
console.log(JSON.stringify(rows));
"

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const ids = db.prepare(\"SELECT id FROM users WHERE name IN ('QA soon','QA expired') OR email LIKE 'code-qr-pro+%' OR email LIKE 'mob-%@example.com' OR email LIKE 'qa-%@example.com'\").all().map((r) => r.id);
for (const id of ids) {
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_events WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('removed users:', ids.length);
"
