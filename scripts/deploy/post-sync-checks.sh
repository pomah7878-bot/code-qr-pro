#!/usr/bin/env bash
# Проверка данных после финальной синхронизации (запускается на старом сервере).
set -uo pipefail
RS="ssh -i /root/.ssh/sync_tmp_ed25519 -o StrictHostKeyChecking=no"
NEW=root@212.22.82.151
DB=/opt/code-qr/server/data/app.db
SQL="SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'sessions',COUNT(*) FROM sessions WHERE expires_at > datetime('now') UNION ALL SELECT 'jobs',COUNT(*) FROM generation_jobs UNION ALL SELECT 'tickets',COUNT(*) FROM support_tickets UNION ALL SELECT 'orders',COUNT(*) FROM orders UNION ALL SELECT 'kb',COUNT(*) FROM kb_articles;"

echo "=== old app ==="
systemctl is-active code-qr || true
echo "=== counts old ==="
sqlite3 "$DB" "$SQL"
echo "=== counts new ==="
$RS "$NEW" "sqlite3 /opt/code-qr/server/data/app.db \"$SQL\""

echo "=== existing production session via new ==="
TOKEN=$($RS "$NEW" "sqlite3 /opt/code-qr/server/data/app.db 'SELECT token FROM sessions WHERE expires_at > datetime(\"now\") ORDER BY id DESC LIMIT 1;'")
echo "token len: ${#TOKEN}"
curl -sS -m 15 --resolve code-qr.stockcity.ru:443:212.22.82.151 -b "cq_session=$TOKEN" https://code-qr.stockcity.ru/api/me -o /tmp/sess2.json -w 'me direct new: %{http_code}\n'
node -e "const d=require('/tmp/sess2.json');console.log('user:', d.user && d.user.email, '| plan:', d.plan && d.plan.id)"

echo "=== same session via old nginx proxy (cached DNS) ==="
curl -sS -m 15 --resolve code-qr.stockcity.ru:443:2.27.86.180 -b "cq_session=$TOKEN" https://code-qr.stockcity.ru/api/me -o /tmp/sess1.json -w 'me via old proxy: %{http_code}\n'

echo "=== cleanup test users ==="
$RS "$NEW" "cd /opt/code-qr/server && node -e \"
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const del = db.prepare(\\\"DELETE FROM users WHERE email LIKE 'qa-post-%' OR email LIKE 'qa-card-%' OR email LIKE 'qa-migrate-%'\\\");
console.log('removed test users:', del.run().changes);
db.prepare('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)').run();
\""

echo "=== real traffic on new nginx (top IPs) ==="
$RS "$NEW" "awk '{print \\$1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -5"

echo "=== relay ==="
$RS "$NEW" "systemctl is-active ai-relay-tunnel; curl -sS -m 5 http://127.0.0.1:3110/health"
ssh root@2.27.86.180 "systemctl is-active ai-relay"
echo CHECKS_DONE
