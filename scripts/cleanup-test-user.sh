#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
EMAIL="$1"
node -e "
const Database=require('better-sqlite3');
const db=new Database('data/app.db');
const info=db.prepare('DELETE FROM users WHERE email=?').run(process.argv[1]);
db.prepare('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)').run();
console.log('removed users:', info.changes);
" "$EMAIL"
echo '--- headers index.html ---'
curl -sSI https://code-qr.stockcity.ru/ | grep -i -E 'cache-control|etag|last-modified|content-encoding'
echo '--- headers asset ---'
ASSET=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /opt/code-qr/web/dist/index.html | head -1 | sed 's#assets/##')
curl -sSI "https://code-qr.stockcity.ru/assets/$ASSET" | grep -i -E 'cache-control|etag|content-length'
