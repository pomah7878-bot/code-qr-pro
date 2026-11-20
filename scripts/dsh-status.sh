#!/usr/bin/env bash
set -uo pipefail
echo "== versions =="
echo "system node: $(node -v)"
echo "dsh node:    $(/opt/node24/bin/node -v)"
echo "dsh:         $(/usr/local/bin/dsh --version)"
echo "dsh path:    $(command -v dsh)"
echo
echo "== dsh home =="
ls -la /opt/code-qr/server/data/dsh-home | sed -n '1,8p'
echo "profiles: $(ls /opt/code-qr/server/data/dsh-home/profiles | tr '\n' ' ')"
echo
echo "== service env =="
pid=$(systemctl show -p MainPID --value code-qr)
tr '\0' '\n' < "/proc/$pid/environ" | grep -E '^(DSH_HOME|DSH_PROFILE|HOME)=' || true
tr '\0' '\n' < "/proc/$pid/environ" | awk -F= '/^DEEPSEEK_API_KEY=/ { print "DEEPSEEK_API_KEY: length=" length($2) }'
echo
echo "== ai settings =="
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log(db.prepare(\"SELECT key, value FROM app_settings WHERE key LIKE 'ai_%' ORDER BY key\").all());
"
echo
echo "== service / health =="
systemctl is-active code-qr
curl -sS https://code-qr.stockcity.ru/api/health
echo
