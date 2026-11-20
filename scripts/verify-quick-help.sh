#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
echo -n 'db version: '
node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.pragma('user_version',{simple:true}))"
for p in "/api/admin/users/1/diagnostics" "/api/admin/security/rate-limits" "/api/admin/security/login-locks"; do
  echo -n "$p -> "
  curl -sS -o /dev/null -w '%{http_code}\n' "https://code-qr.stockcity.ru$p"
done
echo -n 'POST unlock (no auth) -> '
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://code-qr.stockcity.ru/api/admin/users/1/unlock-login -H 'Content-Type: application/json' -d '{}'
echo -n 'login link (bad token) -> '
curl -sS -o /dev/null -w '%{http_code}\n' https://code-qr.stockcity.ru/api/auth/link/zzz
echo -n 'health: '
curl -sS https://code-qr.stockcity.ru/api/health; echo
