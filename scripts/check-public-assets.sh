#!/usr/bin/env bash
set -uo pipefail
for f in icon-192.png icon-512.png apple-touch-icon.png logo.png favicon.svg og-image.png; do
  printf '%-22s ' "$f"
  curl -sS -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' "https://code-qr.stockcity.ru/$f"
done
