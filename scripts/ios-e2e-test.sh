#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server

EMAIL="ios-test-$(date +%s)@example.com"
PASS="Testpass12345"
BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
CJ=/tmp/cq_ios_cj.txt
rm -f "$CJ"

echo "== register =="
curl -sS -c "$CJ" -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"iOS test\"}" \
  -o /tmp/cq_reg.json -w 'register: %{http_code}\n'
head -c 200 /tmp/cq_reg.json; echo

echo "== set premium =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
db.prepare(\"UPDATE users SET plan='premium' WHERE email=?\").run(process.argv[1]);
console.log(db.prepare('SELECT id, plan FROM users WHERE email=?').get(process.argv[1]));
" "$EMAIL"

echo "== login =="
curl -sS -c "$CJ" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  -o /tmp/cq_login.json -w 'login: %{http_code}\n'
head -c 200 /tmp/cq_login.json; echo

echo "== labels ticket =="
curl -sS -b "$CJ" -X POST "$BASE/api/labels/pdf/ticket" \
  -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d '{"template":{"name":"iOS test","widthMm":58,"heightMm":40,"dpi":203,"elements":[{"id":"dm","type":"datamatrix","x":2,"y":2,"w":30,"h":30}]},"rows":[{"code":"0104638230913287215Xk!ABCdef"}],"single":true,"source":"reprint"}' \
  -o /tmp/cq_ticket.json -w 'ticket: %{http_code}\n'
cat /tmp/cq_ticket.json; echo

URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/cq_ticket.json','utf8')).url||'')}catch{console.log('')}")
if [ -z "$URL" ]; then
  echo "NO URL — abort"
  node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
db.prepare('DELETE FROM users WHERE email=?').run(process.argv[1]);
" "$EMAIL"
  exit 1
fi

echo "== download pdf by url =="
curl -sS -b "$CJ" "$BASE$URL" -o /tmp/cq_out.pdf -D /tmp/cq_out.h -w 'file: %{http_code} type=%{content_type} size=%{size_download}\n'
head -c 5 /tmp/cq_out.pdf; echo
grep -i -E 'content-disposition|cache-control|x-content-type' /tmp/cq_out.h || true

echo "== second fetch (link reusable within TTL) =="
curl -sS -b "$CJ" "$BASE$URL" -o /dev/null -w 'refetch: %{http_code} size=%{size_download}\n'

echo "== ticket without auth =="
curl -sS -o /dev/null -w 'noauth: %{http_code}\n' -X POST "$BASE/api/labels/pdf/ticket" -H 'Content-Type: application/json' -d '{}'

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const info = db.prepare('DELETE FROM users WHERE email=?').run(process.argv[1]);
db.prepare('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)').run();
console.log('removed users:', info.changes);
" "$EMAIL"
rm -f "$CJ" /tmp/cq_reg.json /tmp/cq_login.json /tmp/cq_ticket.json /tmp/cq_out.pdf /tmp/cq_out.h
echo "DONE"
