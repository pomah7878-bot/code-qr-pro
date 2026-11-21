#!/usr/bin/env bash
# Поднимает staging-копию приложения на новом сервере: отдельная БД (снимок прода), порт 3200.
set -euo pipefail
SRC=/opt/code-qr
DST=/opt/code-qr-staging
mkdir -p "$DST/server" "$DST/server/data"
# код (без data) + web dist
rsync -a --delete --exclude 'data/' "$SRC/server/" "$DST/server/"
rsync -a "$SRC/web/" "$DST/web/"
# исходники из репозитория уже залиты в /tmp/staging-src
rsync -a /tmp/staging-src/ "$DST/server/src/"
# node_modules — жёсткие ссылки, чтобы не копировать 200 МБ
if [ ! -d "$DST/server/node_modules" ]; then
  cp -al "$SRC/server/node_modules" "$DST/server/node_modules"
fi
# снимок прод-базы (консистентный backup через sqlite)
rm -f "$DST/server/data/app.db" "$DST/server/data/app.db-wal" "$DST/server/data/app.db-shm"
sqlite3 "$SRC/server/data/app.db" ".backup '$DST/server/data/app.db'"
cp -a "$SRC/server/data/.app-key" "$DST/server/data/.app-key" 2>/dev/null || true
cp -a "$SRC/server/data/dsh-home" "$DST/server/data/dsh-home" 2>/dev/null || true
chown -R codeqr:codeqr "$DST/server/data" 2>/dev/null || true
# .env (для ключей ЮKassa/Telegram), но запуск — на 3200
cp -a "$SRC/server/.env" "$DST/server/.env"
chown codeqr:codeqr "$DST/server/.env" 2>/dev/null || true
echo "staging prepared"; du -sh "$DST"
