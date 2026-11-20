#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
EMAIL="ios-ui-$(date +%s)@example.com"
PASS="Testpass12345"
curl -sS -X POST https://code-qr.stockcity.ru/api/auth/register \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://code-qr.stockcity.ru' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"iOS UI\"}" -o /tmp/ui_reg.json -w 'register: %{http_code}\n'
node -e "
const Database=require('better-sqlite3');
const db=new Database('data/app.db');
db.prepare(\"UPDATE users SET plan='premium' WHERE email=?\").run(process.argv[1]);
" "$EMAIL"
echo "EMAIL=$EMAIL"
echo "PASS=$PASS"
