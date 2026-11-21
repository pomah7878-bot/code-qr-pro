#!/usr/bin/env bash
# Переключает nginx старого сервера на проксирование нового (для пользователей с кэшем DNS).
set -euo pipefail
CONF=/etc/nginx/sites-available/code-qr.stockcity.ru.conf
BAK=/etc/nginx/sites-available/code-qr.stockcity.ru.conf.pre-migrate
[ -f "$BAK" ] || cp -a "$CONF" "$BAK"

python3 - <<'PY'
p = '/etc/nginx/sites-available/code-qr.stockcity.ru.conf'
s = open(p).read()
if 'proxy_pass https://212.22.82.151;' in s:
    print('already proxying')
    raise SystemExit
s = s.replace('        proxy_pass http://127.0.0.1:3100;', '        proxy_pass https://212.22.82.151;')
s = s.replace('        proxy_set_header X-Forwarded-Proto $scheme;', '''        proxy_set_header X-Forwarded-Proto https;
        proxy_ssl_server_name on;
        proxy_ssl_name code-qr.stockcity.ru;
        proxy_ssl_verify off;''')
open(p, 'w').write(s)
print('conf rewritten')
PY

nginx -t
systemctl reload nginx
echo "=== test through old nginx -> new ==="
curl -sS -m 15 --resolve code-qr.stockcity.ru:443:2.27.86.180 -o /tmp/proxytest.html -w 'via old nginx: %{http_code}\n' https://code-qr.stockcity.ru/api/health
cat /tmp/proxytest.html; echo
echo NGINX_PROXY_READY
