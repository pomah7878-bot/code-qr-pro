#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
echo -n 'db version: '
node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log(db.pragma('user_version',{simple:true}))"
for p in /api/admin/mail-templates /api/admin/security/allowlist; do
  echo -n "$p -> "; curl -sS -o /dev/null -w '%{http_code}\n' "https://code-qr.stockcity.ru$p"
done
echo -n 'POST impersonate (no auth) -> '
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://code-qr.stockcity.ru/api/admin/users/1/impersonate -H 'Content-Type: application/json' -d '{}'
echo -n 'POST compensate (no auth) -> '
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://code-qr.stockcity.ru/api/admin/users/1/compensate -H 'Content-Type: application/json' -d '{"days":3}'
echo -n 'view link (bad token) -> '
curl -sS -o /dev/null -w '%{http_code}\n' https://code-qr.stockcity.ru/api/admin/view/zzz
echo -n 'health: '; curl -sS https://code-qr.stockcity.ru/api/health; echo
node -e "const D=require('better-sqlite3');const db=new D('data/app.db');console.log('app_logs:', db.prepare('SELECT COUNT(*) c FROM app_logs').get().c, '| login_events:', db.prepare('SELECT COUNT(*) c FROM login_events').get().c, '| allowlist:', db.prepare('SELECT COUNT(*) c FROM ip_allowlist').get().c, '| view_sessions:', db.prepare('SELECT COUNT(*) c FROM view_sessions').get().c)"
