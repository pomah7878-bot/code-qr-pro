#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' .env)
CHAT=$(sed -n 's/^TELEGRAM_ADMIN_ID=//p' .env)
echo "token len: ${#TOKEN}, chat: ${CHAT}"

echo "== DNS =="
getent hosts api.telegram.org || echo 'dns fail'

echo "== curl getMe (10s) =="
curl -sS -m 10 "https://api.telegram.org/bot${TOKEN}/getMe" -o /tmp/tg-getme.json -w 'http: %{http_code} ip: %{remote_ip} time: %{time_total}\n' || true
head -c 300 /tmp/tg-getme.json 2>/dev/null; echo

echo "== curl -4 =="
curl -4 -sS -m 10 "https://api.telegram.org/bot${TOKEN}/getMe" -o /dev/null -w 'ipv4: %{http_code} ip: %{remote_ip}\n' || true

echo "== curl -6 =="
curl -6 -sS -m 10 "https://api.telegram.org/bot${TOKEN}/getMe" -o /dev/null -w 'ipv6: %{http_code}\n' || true

echo "== node fetch test =="
node -e "
const t = process.argv[1];
fetch('https://api.telegram.org/bot' + t + '/getMe', { signal: AbortSignal.timeout(10000) })
  .then(async (r) => console.log('node fetch:', r.status, (await r.text()).slice(0, 120)))
  .catch((e) => console.log('node fetch error:', e.message, e.cause && e.cause.code));
" "$TOKEN"
rm -f /tmp/tg-getme.json
