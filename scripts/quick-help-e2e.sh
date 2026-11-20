#!/usr/bin/env bash
# E2E «быстрая помощь»: админ снимает ограничения и выдаёт ссылку входа.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
ADMIN_TOKEN="a$(date +%s)bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CLIENT_TOKEN="c$(date +%s)bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
ADMIN_EMAIL="qa-admin-$(date +%s)@example.com"
CLIENT_EMAIL="qa-client-$(date +%s)@example.com"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const mk = (email, role, token) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
  const info = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)')
    .run(email, salt + ':' + hash, email.split('@')[0], role);
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
    .run(token, crypto.randomBytes(16).toString('hex'), id, new Date(Date.now() + 86400_000).toISOString(), '10.9.9.9', 'qa');
  return id;
};
const adminId = mk(process.argv[1], 'admin', process.argv[3]);
db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(adminId);
const clientId = mk(process.argv[2], 'user', process.argv[4]);
const today = new Date().toISOString().slice(0, 10);
db.prepare(\"INSERT OR REPLACE INTO login_attempts (email, fails, window_start, locked_until, last_at) VALUES (?, 5, datetime('now'), datetime('now','+10 minutes'), datetime('now'))\").run(process.argv[2]);
db.prepare('INSERT OR REPLACE INTO usage_daily (user_id, day, codes_generated) VALUES (?,?,?)').run(clientId, today, 7);
db.prepare(\"UPDATE users SET totp_enabled=1, totp_secret='x', must_change_password=1 WHERE id=?\").run(clientId);
db.prepare(\"INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES ('ip:10.9.9.9', ?, 999)\").run(Math.floor(Date.now() / 1000));
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
console.log('TODAY=' + today);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$ADMIN_TOKEN" "$CLIENT_TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$CLIENT_EMAIL")

echo "== diagnostics =="
curl -sS "$BASE/api/admin/users/$CLIENT_ID/diagnostics" -H "Cookie: cq_session=$ADMIN_TOKEN" | head -c 700; echo

echo "== unlock login =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/unlock-login" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}' -w ' [%{http_code}]'; echo

echo "== reset usage =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/reset-usage" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}' -w ' [%{http_code}]'; echo

echo "== reset 2fa =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/reset-2fa" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}' -w ' [%{http_code}]'; echo

echo "== clear password flag =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/clear-password-flag" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}' -w ' [%{http_code}]'; echo

echo "== clear rate limits =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/clear-rate-limits" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}' -w ' [%{http_code}]'; echo

echo "== security lists =="
curl -sS "$BASE/api/admin/security/rate-limits" -H "Cookie: cq_session=$ADMIN_TOKEN" | head -c 200; echo
curl -sS "$BASE/api/admin/security/login-locks" -H "Cookie: cq_session=$ADMIN_TOKEN" | head -c 200; echo

echo "== login link =="
LINK_JSON=$(curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/login-link" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}')
echo "$LINK_JSON"
LINK=$(node -e "try{console.log(JSON.parse(process.argv[1]).url||'')}catch(e){console.log('')}" "$LINK_JSON")
if [ -n "$LINK" ]; then
  echo "== open link =="
  curl -sS -o /dev/null -D /tmp/link.h -c /tmp/link.cj "$LINK" -w 'link: %{http_code} -> %{redirect_url}\n'
  grep -i -E 'set-cookie|location' /tmp/link.h | head -3
  echo "== /api/me with link cookie =="
  curl -sS -b /tmp/link.cj "$BASE/api/me" | head -c 220; echo
fi

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const email of [process.argv[1], process.argv[2]]) {
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (u) {
    db.prepare('DELETE FROM login_links WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM usage_daily WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  }
  db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
}
db.prepare(\"DELETE FROM rate_limits WHERE key='ip:10.9.9.9'\").run();
console.log('cleanup done');
" "$ADMIN_EMAIL" "$CLIENT_EMAIL"
rm -f /tmp/link.h /tmp/link.cj
