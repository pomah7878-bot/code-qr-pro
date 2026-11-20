#!/usr/bin/env bash
# E2E всех 7 админских возможностей.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
ADMIN_EMAIL="qa-a7-admin-$STAMP@example.com"
CLIENT_EMAIL="qa-a7-client-$STAMP@example.com"
ADMIN_TOKEN="a$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

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
db.prepare(\"UPDATE users SET plan='premium' WHERE id=?\").run(clientId);
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now','+10 days'))\").run(clientId);
db.prepare('INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES (?,?,?,?)').run(clientId, 'QA key', 'qa', 'qa-hash-$STAMP');
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[3], crypto.randomBytes(16).toString('hex'), adminId, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log('ADMIN_ID=' + adminId);
console.log('CLIENT_ID=' + clientId);
" "$ADMIN_EMAIL" "$CLIENT_EMAIL" "$ADMIN_TOKEN"

ADMIN_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$ADMIN_EMAIL")
CLIENT_ID=$(node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.prepare('SELECT id FROM users WHERE email=?').get(process.argv[1]).id)" "$CLIENT_EMAIL")

echo "== 4) login history: wrong + right password =="
curl -sS -o /dev/null -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -H "$ORIGIN" -d "{\"email\":\"$CLIENT_EMAIL\",\"password\":\"wrong-pass-123\"}" -w 'wrong: %{http_code}\n'
curl -sS -o /dev/null -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -H "$ORIGIN" -d "{\"email\":\"$CLIENT_EMAIL\",\"password\":\"Testpass12345\"}" -w 'right: %{http_code}\n'
curl -sS "$BASE/api/admin/users/$CLIENT_ID/diagnostics" -H "Cookie: cq_session=$ADMIN_TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log('logins:', JSON.stringify((d.logins||[]).slice(0,3)))})"

echo "== 5) compensation =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/compensate" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"days":3,"reason":"QA инцидент"}' -w ' [%{http_code}]'; echo

echo "== 3) revoke api keys =="
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/revoke-api-keys" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}' -w ' [%{http_code}]'; echo

echo "== 1) mail templates + validation =="
curl -sS "$BASE/api/admin/mail-templates" -H "Cookie: cq_session=$ADMIN_TOKEN" | head -c 200; echo
curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/message" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"template":"custom","subject":"","text":""}' -w ' [%{http_code}]'; echo

echo "== 2) impersonation (read-only) =="
VIEW_JSON=$(curl -sS -X POST "$BASE/api/admin/users/$CLIENT_ID/impersonate" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}')
echo "$VIEW_JSON" | head -c 260; echo
VIEW_URL=$(node -e "try{console.log(JSON.parse(process.argv[1]).url||'')}catch(e){console.log('')}" "$VIEW_JSON")
if [ -n "$VIEW_URL" ]; then
  rm -f /tmp/view.cj
  curl -sS -o /dev/null -c /tmp/view.cj "$VIEW_URL" -w 'open: %{http_code}\n'
  echo -n 'me as client: '; curl -sS -b /tmp/view.cj "$BASE/api/me" | head -c 220; echo
  echo -n 'POST blocked: '; curl -sS -o /dev/null -w '%{http_code}\n' -b /tmp/view.cj -X POST "$BASE/api/labels/print" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}'
  echo -n 'admin still works: '; curl -sS -H "Cookie: cq_session=$ADMIN_TOKEN" "$BASE/api/me" | head -c 120; echo
fi

echo "== 6) IP allowlist =="
curl -sS -X POST "$BASE/api/admin/security/allowlist" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"ip":"10.9.9.9","note":"QA офис"}' -w ' [%{http_code}]'; echo
curl -sS "$BASE/api/admin/security/allowlist" -H "Cookie: cq_session=$ADMIN_TOKEN" | head -c 200; echo
curl -sS -X DELETE "$BASE/api/admin/security/allowlist/10.9.9.9" -H "Cookie: cq_session=$ADMIN_TOKEN" -H "$ORIGIN" -w ' [%{http_code}]'; echo

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const email of [process.argv[1], process.argv[2]]) {
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (u) {
    db.prepare('DELETE FROM api_keys WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM view_sessions WHERE user_id=? OR admin_id=?').run(u.id, u.id);
    db.prepare('DELETE FROM login_events WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  }
  db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
  db.prepare('DELETE FROM login_events WHERE email=?').run(email);
}
db.prepare(\"DELETE FROM ip_allowlist WHERE ip='10.9.9.9'\").run();
console.log('cleanup done');
" "$ADMIN_EMAIL" "$CLIENT_EMAIL"
rm -f /tmp/view.cj
