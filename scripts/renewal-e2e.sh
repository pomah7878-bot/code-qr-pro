#!/usr/bin/env bash
# Проверка писем о продлении/окончании PREMIUM и новых шаблонов.
set -uo pipefail
cd /opt/code-qr/server

FROM=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');const r=db.prepare(\"SELECT value FROM app_settings WHERE key='smtp_from_email'\").get();console.log(r?r.value:'')")
echo "mailbox: $FROM"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const mk = (name) => db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)')
  .run(process.argv[1], salt + ':' + hash, name).lastInsertRowid;
const soon = mk('QA soon');
db.prepare(\"UPDATE users SET plan='premium' WHERE id=?\").run(soon);
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now','-28 days'), datetime('now','+2 days'))\").run(soon);
const expired = mk('QA expired');
db.prepare(\"UPDATE users SET plan='premium' WHERE id=?\").run(expired);
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now','-31 days'), datetime('now','-1 day'))\").run(expired);
console.log('SOON_ID=' + soon);
console.log('EXPIRED_ID=' + expired);
" "$FROM"

SOON_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare(\"SELECT id FROM users WHERE name='QA soon' ORDER BY id DESC LIMIT 1\").get().id)")
EXPIRED_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare(\"SELECT id FROM users WHERE name='QA expired' ORDER BY id DESC LIMIT 1\").get().id)")

echo "== notifyExpiringSoon =="
node -e "import('./src/billing.js').then((m) => { console.log('sent:', m.notifyExpiringSoon(3)); }).catch((e) => { console.error(e); process.exit(1); })"
sleep 3
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const u = db.prepare('SELECT premium_notice_at FROM users WHERE id=?').get(Number(process.argv[1]));
console.log('notice flag set:', Boolean(u?.premium_notice_at));
" "$SOON_ID"

echo "== expireSubscriptions =="
node -e "import('./src/billing.js').then((m) => { m.expireSubscriptions(); console.log('done'); }).catch((e) => { console.error(e); process.exit(1); })"
sleep 3
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of process.argv.slice(1).map(Number)) {
  const u = db.prepare('SELECT id, plan FROM users WHERE id=?').get(id);
  console.log(id, '->', u ? u.plan : 'deleted');
}
" "$SOON_ID" "$EXPIRED_ID"

echo "== previews of new templates =="
node -e "
import('./src/lib/client-mail.js').then((m) => {
  const user = { id: 1, email: 'x@example.com', name: 'Тест' };
  for (const [tpl, vars] of [['premium_renewed', { until: '2026-12-20' }], ['premium_expiring', { until: '2026-11-23' }], ['premium_expired', { until: '2026-11-19' }]]) {
    const p = m.previewClientMessage(user, { template: tpl, vars });
    console.log(tpl, '|', p.subject, '| html:', p.html.length, '| badge:', /PREMIUM|Напоминание|Тариф/.test(p.html));
  }
}).catch((e) => { console.error(e); process.exit(1); });
"

echo "== mail errors =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log(db.prepare(\"SELECT COUNT(*) c FROM app_logs WHERE source='mail' AND created_at > datetime('now','-10 minutes')\").get().c);
"

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const id of process.argv.slice(1).map(Number)) {
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_events WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
console.log('cleanup done');
" "$SOON_ID" "$EXPIRED_ID"
