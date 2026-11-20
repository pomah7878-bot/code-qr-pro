#!/usr/bin/env bash
# Атомарно раскладывает собранный web в /opt/code-qr/web/dist.
# Использование: скопировать index.html и assets/* в /tmp/cq-web/{index.html,assets/}, затем запустить этот скрипт.
# Права 644/755 выставляются сразу — сервис (codeqr) никогда не увидит нечитаемый ассет.
set -euo pipefail

SRC="${1:-/tmp/cq-web}"
DST=/opt/code-qr/web/dist

if [ ! -d "$SRC" ]; then
  echo "нет каталога $SRC" >&2
  exit 1
fi

mkdir -p "$DST/assets"
chmod 755 "$DST" "$DST/assets"

if [ -f "$SRC/index.html" ]; then
  install -m 644 "$SRC/index.html" "$DST/index.html"
fi

if [ -d "$SRC/assets" ]; then
  count=0
  for f in "$SRC"/assets/*; do
    [ -f "$f" ] || continue
    install -m 644 "$f" "$DST/assets/"
    count=$((count + 1))
  done
  echo "assets: $count"
fi

chmod -R a+rX "$DST"
echo "dist_ok"
