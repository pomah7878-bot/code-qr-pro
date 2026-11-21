#!/usr/bin/env bash
# Финальные проверки данных и сессий на новом сервере.
set -uo pipefail
cd /opt/code-qr/server
DB=data/app.db

echo "=== production session ==="
TOKEN=$(sqlite3 "$DB" "SELECT token FROM sessions WHERE expires_at > datetime('now') LIMIT 1;")
echo "token len: ${#TOKEN}"
curl -sS -m 15 --resolve code-qr.stockcity.ru:443:212.22.82.151 -b "cq_session=$TOKEN" https://code-qr.stockcity.ru/api/me -o /tmp/sess.json -w 'me: %{http_code}\n'
head -c 260 /tmp/sess.json; echo

echo "=== cleanup test users/sessions ==="
sqlite3 "$DB" "DELETE FROM users WHERE email LIKE 'qa-post-%' OR email LIKE 'qa-card-%' OR email LIKE 'qa-migrate-%';"
sqlite3 "$DB" "DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users);"
sqlite3 "$DB" "SELECT 'users',COUNT(*) FROM users; SELECT 'sessions',COUNT(*) FROM sessions; SELECT 'jobs',COUNT(*) FROM generation_jobs; SELECT 'orders',COUNT(*) FROM orders; SELECT 'tickets',COUNT(*) FROM support_tickets; SELECT 'kb',COUNT(*) FROM kb_articles;"

echo "=== integrity ==="
sqlite3 "$DB" 'PRAGMA integrity_check;'

echo "=== real traffic on nginx (top IPs) ==="
awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -5

echo "=== services ==="
for u in code-qr nginx ai-relay-tunnel; do printf '%s: ' "$u"; systemctl is-active "$u"; done

echo "=== last app errors ==="
journalctl -u code-qr --since '-15 min' --no-pager | grep -Ei '"level":(50|60)' | tail -3 || echo none
echo FINAL_CHECKS_DONE
