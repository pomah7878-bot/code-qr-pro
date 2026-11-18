#!/usr/bin/env bash
# Ежедневный бэкап БД CODE QR PRO (sqlite .backup — консистентно при WAL)
set -euo pipefail
DIR=/opt/backups/code-qr
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 /opt/code-qr/server/data/app.db ".backup '$DIR/app-$STAMP.db'"
gzip -f "$DIR/app-$STAMP.db"
find "$DIR" -name "app-*.db.gz" -mtime +14 -delete
echo "backup ok: app-$STAMP.db.gz"
