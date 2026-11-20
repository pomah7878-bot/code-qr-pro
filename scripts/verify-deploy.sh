#!/usr/bin/env bash
set -uo pipefail
ASSET=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /opt/code-qr/web/dist/index.html | head -1 | sed 's#assets/##')
echo "index.html asset: $ASSET"
echo "file exists: $(test -f /opt/code-qr/web/dist/assets/$ASSET && echo yes || echo no)"
echo -n 'has /ticket in bundle: '; grep -c '/ticket' /opt/code-qr/web/dist/assets/$ASSET || true
echo -n 'has ontouchend: '; grep -c 'ontouchend' /opt/code-qr/web/dist/assets/$ASSET || true
echo -n 'http asset: '; curl -sS -o /dev/null -w '%{http_code} size=%{size_download}\n' "https://code-qr.stockcity.ru/assets/$ASSET"
echo -n 'http index: '; curl -sS -o /dev/null -w '%{http_code}\n' https://code-qr.stockcity.ru/
echo -n 'health: '; curl -sS https://code-qr.stockcity.ru/api/health; echo
echo -n 'ticket noauth: '; curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://code-qr.stockcity.ru/api/labels/pdf/ticket -H 'Content-Type: application/json' -d '{}'
echo -n 'sets ticket noauth: '; curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://code-qr.stockcity.ru/api/sets/pdf/ticket -H 'Content-Type: application/json' -d '{}'
