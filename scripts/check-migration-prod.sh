#!/usr/bin/env bash
# Проверяет миграцию v20 на копии боевой базы, не трогая рабочую.
set -uo pipefail
cd /opt/code-qr/server
cp data/app.db /tmp/app-copy.db
rm -f /tmp/app-copy.db-wal /tmp/app-copy.db-shm
DB_PATH=/tmp/app-copy.db node -e "
const run = async () => {
  const m = await import('./src/db.js');
  const v = m.db.pragma('user_version', { simple: true });
  const t = m.db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='login_links'\").get();
  const i = m.db.prepare(\"SELECT name FROM sqlite_master WHERE type='index' AND name='idx_login_links_user'\").get();
  console.log(JSON.stringify({ version: v, loginLinks: Boolean(t), index: Boolean(i) }));
};
run();
"
rm -f /tmp/app-copy.db /tmp/app-copy.db-wal /tmp/app-copy.db-shm
