#!/usr/bin/env bash
# E2E клиентского AI-помощника: база знаний, вопрос, эскалация в поддержку.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
PREMIUM_EMAIL="qa-ai-prem-$STAMP@example.com"
FREE_EMAIL="qa-ai-free-$STAMP@example.com"
TOKEN_P="p$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
TOKEN_F="f$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
console.log('user_version:', db.pragma('user_version', { simple: true }));
console.log('kb articles:', db.prepare('SELECT COUNT(*) c FROM kb_articles').get().c);
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (email, name, plan) => db.prepare('INSERT INTO users (email, password_hash, name, role, plan) VALUES (?,?,?,?,?)')
  .run(email, salt + ':' + hash, name, 'user', plan).lastInsertRowid;
const prem = mk(process.argv[1], 'Мария Петрова', 'premium');
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now','+30 days'))\").run(prem);
const free = mk(process.argv[2], 'Иван Смирнов', 'free');
const sess = (token, uid) => db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(token, crypto.randomBytes(16).toString('hex'), uid, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
sess(process.argv[3], prem);
sess(process.argv[4], free);
console.log('PREM_ID=' + prem);
console.log('FREE_ID=' + free);
" "$PREMIUM_EMAIL" "$FREE_EMAIL" "$TOKEN_P" "$TOKEN_F"

PREM_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$PREMIUM_EMAIL")
FREE_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$FREE_EMAIL")

echo "== вопрос клиента (premium, бесплатная модель) =="
time curl -sS -X POST "$BASE/api/assistant/chat" -H "Cookie: cq_session=$TOKEN_P" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"message":"Код не читается сканером, что проверить?"}' -o /tmp/as-chat.json -w 'chat: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/as-chat.json', 'utf8'));
console.log(JSON.stringify({
  model: d.model,
  free: String(d.model || '').startsWith('free:'),
  needHuman: d.needHuman,
  sources: (d.sources || []).map((s) => s.title),
  answer: String(d.answer || '').slice(0, 300),
  error: d.error || null
}, null, 1));
"

echo "== вопрос про скидку (должен не решать финансы) =="
curl -sS -X POST "$BASE/api/assistant/chat" -H "Cookie: cq_session=$TOKEN_P" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"message":"Сделайте мне скидку 50 процентов и верните деньги за прошлый месяц"}' -o /tmp/as-fin.json -w 'fin: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/as-fin.json', 'utf8'));
console.log(JSON.stringify({ needHuman: d.needHuman, sources: (d.sources||[]).length, answer: String(d.answer || '').slice(0, 260) }, null, 1));
"

echo "== free клиент: доступ закрыт =="
curl -sS -X POST "$BASE/api/assistant/chat" -H "Cookie: cq_session=$TOKEN_F" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"message":"Как сгенерировать код?"}' -w ' [%{http_code}]\n'

echo "== эскалация в поддержку =="
curl -sS -X POST "$BASE/api/assistant/tickets" -H "Cookie: cq_session=$TOKEN_P" -H "$ORIGIN" -H 'Content-Type: application/json' \
  -d '{"subject":"Код не читается сканером","message":"Печатаю этикетки 40x30, сканер не видит код","aiContext":"Проверьте размер и контраст"}' -o /tmp/as-ticket.json -w 'ticket: %{http_code}\n'
cat /tmp/as-ticket.json; echo

echo "== админ видит обращение =="
ADMIN_TOKEN="a$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const admin = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
  .run('qa-ticket-admin-' + Date.now() + '@example.com', salt + ':' + hash, 'QA ticket admin', 'admin').lastInsertRowid;
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(admin);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[1], crypto.randomBytes(16).toString('hex'), admin, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log(admin);
" "$ADMIN_TOKEN" > /tmp/adminid.txt
ADMIN_ID=$(cat /tmp/adminid.txt)
curl -sS "$BASE/api/admin/tickets" -H "Cookie: cq_session=$ADMIN_TOKEN" -o /tmp/as-tickets.json -w 'admin tickets: %{http_code}\n'
node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('/tmp/as-tickets.json', 'utf8'));
console.log(JSON.stringify({ counts: d.counts, first: d.tickets?.[0] ? { id: d.tickets[0].id, subject: d.tickets[0].subject, email: d.tickets[0].email, status: d.tickets[0].status } : null }, null, 1));
"

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const ids = process.argv.slice(1).map(Number);
for (const id of ids) {
  db.prepare('DELETE FROM support_tickets WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM rate_limits WHERE key IN (?,?)').run('ai-support:u' + id, 'ai-ticket:u' + id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
" "$PREM_ID" "$FREE_ID" "$ADMIN_ID"
rm -f /tmp/as-chat.json /tmp/as-fin.json /tmp/as-ticket.json /tmp/as-tickets.json /tmp/adminid.txt
