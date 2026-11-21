#!/usr/bin/env bash
# ФИНАЛЬНАЯ синхронизация БД со старого (UK) на новый (RU) сервер.
# Запускается НА СТАРОМ сервере в момент переключения DNS:
# останавливает оба приложения, делает чекпойнт WAL, копирует data/ и поднимает новое.
# Даунтайм ~8-12 секунд.
set -euo pipefail
RS="ssh -i /root/.ssh/sync_tmp_ed25519 -o StrictHostKeyChecking=no -o ConnectTimeout=10"
NEW=root@212.22.82.151
DATA=/opt/code-qr/server/data

echo "=== stop old app ==="
systemctl stop code-qr
sleep 1

echo "=== wal checkpoint ==="
sqlite3 "$DATA/app.db" 'PRAGMA wal_checkpoint(TRUNCATE);' || true

echo "=== stop new app (чтобы не писать в БД во время копирования) ==="
$RS "$NEW" 'systemctl stop code-qr' || true

echo "=== rsync data -> new ==="
rsync -a -e "$RS" "$DATA/" "$NEW:/opt/code-qr/server/data/"

echo "=== perms + start new app ==="
$RS "$NEW" 'chown -R codeqr:codeqr /opt/code-qr/server/data && chmod 700 /opt/code-qr/server/data && systemctl start code-qr && sleep 3 && systemctl is-active code-qr'
$RS "$NEW" 'curl -sS -m 10 http://127.0.0.1:3100/api/health' || true
echo
echo "FINAL_SYNC_DONE old_app=stopped new_app=active"
