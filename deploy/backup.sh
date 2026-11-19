#!/usr/bin/env bash
# Ежедневный бэкап БД CODE QR PRO: AES-256-GCM + проверка восстановлением.
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/code-qr}"
cd /opt/code-qr/server
export BACKUP_DIR
/usr/bin/node scripts/backup.mjs
LATEST=$(ls -t "$BACKUP_DIR"/app-*.db.enc | head -1)
/usr/bin/node scripts/verify-backup.mjs "$LATEST"
# Старые незашифрованные .gz больше не нужны после успешной проверки.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'app-*.db.gz' -delete
echo "backup ok + restore verified: $LATEST"
