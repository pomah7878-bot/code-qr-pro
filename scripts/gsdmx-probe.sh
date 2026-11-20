#!/usr/bin/env bash
# Разведка источника данных на gsdmx.ru: HTML, скрипты, возможные API-эндпоинты.
set -uo pipefail
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE="https://gsdmx.ru"

echo "== главная =="
curl -4 -sS -m 20 -A "$UA" "$BASE/" -o /tmp/gsdmx.html -D /tmp/gsdmx.h -w 'http: %{http_code} size: %{size_download}\n' || true
head -c 200 /tmp/gsdmx.html; echo

echo "== скрипты =="
node <<'NODE'
const fs = require('node:fs');
const html = fs.readFileSync('/tmp/gsdmx.html', 'utf8').catch?.(() => '') || '';
NODE

node -e "
const fs = require('node:fs');
const html = fs.readFileSync('/tmp/gsdmx.html', 'utf8');
const srcs = [...html.matchAll(/<script[^>]+src=\"([^\"]+)\"/g)].map((m) => m[1]);
const links = [...html.matchAll(/<link[^>]+href=\"([^\"]+)\"/g)].map((m) => m[1]).filter((h) => /\.(js|css)$/.test(h));
console.log('scripts:', JSON.stringify(srcs.slice(0, 20)));
console.log('assets:', JSON.stringify(links.slice(0, 20)));
const hints = [...html.matchAll(/(https?:\/\/[^\s\"'<>]+)/g)].map((m) => m[1]);
console.log('urls:', JSON.stringify([...new Set(hints)].slice(0, 30)));
"
