#!/usr/bin/env bash
set -uo pipefail
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE="https://gsdmx.ru"
mkdir -p /tmp/gsdmx-js
for f in scripts.js mobile-scanner.js serial-scanner.js; do
  url="$BASE/static/js/$f"
  curl -4 -sS -m 20 -A "$UA" "$url" -o "/tmp/gsdmx-js/$f" -w "$f: %{http_code} %{size_download}\n" || true
done

node <<'NODE'
const fs = require('node:fs');
const dir = '/tmp/gsdmx-js';
for (const f of fs.readdirSync(dir)) {
  const s = fs.readFileSync(`${dir}/${f}`, 'utf8');
  console.log(`\n===== ${f} (${s.length} bytes) =====`);
  const urls = [...s.matchAll(/(?:fetch|axios\.(?:get|post)|\.open)\s*\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1]);
  const apis = [...s.matchAll(/[`'"](\/[a-zA-Z0-9_\-./?=&]{3,80})[`'"]/g)].map((m) => m[1]).filter((u) => /api|check|verify|product|code|crpt|true|token/i.test(u));
  console.log('fetch/open URLs:', JSON.stringify([...new Set(urls)].slice(0, 30)));
  console.log('api-like paths:', JSON.stringify([...new Set(apis)].slice(0, 30)));
  const hosts = [...s.matchAll(/https?:\/\/[a-zA-Z0-9.-]+/g)].map((m) => m[0]);
  console.log('hosts:', JSON.stringify([...new Set(hosts)].slice(0, 20)));
}
NODE
