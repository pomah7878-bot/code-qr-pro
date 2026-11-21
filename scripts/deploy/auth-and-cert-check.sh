#!/usr/bin/env bash
# Проверка входа/сессии на новом сервере и автопродления сертификата.
set -uo pipefail
cd /opt/code-qr/server
BASE="https://code-qr.stockcity.ru"
DB=data/app.db
RESOLVE="code-qr.stockcity.ru:443:212.22.82.151"
PASS='QaTestPass123!'
HASH=$(node -e "const B=require('bcryptjs');console.log(B.hashSync('QaTestPass123!', 10))")
EMAIL="qa-login-$(date +%s)@example.com"
sqlite3 "$DB" "INSERT INTO users (email, password_hash, name, role, plan) VALUES ('$EMAIL', '$HASH', 'QA login', 'user', 'premium');"
echo "created: $EMAIL"

BODY=$(node -e "console.log(JSON.stringify({email: process.argv[1], password: process.argv[2]}))" "$EMAIL" "$PASS")
curl -sS -m 15 --resolve "$RESOLVE" -c /tmp/cq-cookies.txt -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d "$BODY" -o /tmp/login.json -w 'login: %{http_code}\n'
head -c 220 /tmp/login.json; echo

curl -sS -m 15 --resolve "$RESOLVE" -b /tmp/cq-cookies.txt "$BASE/api/me" -o /tmp/me2.json -w 'me (cookie jar): %{http_code}\n'
head -c 200 /tmp/me2.json; echo

sqlite3 "$DB" "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='$EMAIL'); DELETE FROM users WHERE email='$EMAIL';"

echo "=== certbot renew --dry-run ==="
certbot renew --dry-run 2>&1 | tail -8
echo AUTH_CHECK_DONE
