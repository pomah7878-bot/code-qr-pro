#!/usr/bin/env bash
# Проверки после разбора журнала: корректные коды ошибок и чистый журнал.
set -uo pipefail

BASE="https://code-qr.stockcity.ru"

echo "== 1) запрос без Content-Type (раньше 500) =="
curl -sS -o /tmp/r1.json -w 'code: %{http_code}\n' -X POST "$BASE/api/labels/pdf/task" -d 'rawdata'
head -c 200 /tmp/r1.json; echo

echo "== 2) несуществующий ассет (раньше 500 EACCES/ENOENT) =="
curl -sS -o /tmp/r2.json -w 'code: %{http_code}\n' "$BASE/assets/does-not-exist-123.js"
head -c 120 /tmp/r2.json; echo

echo "== 3) пустой JSON-запрос =="
curl -sS -o /tmp/r3.json -w 'code: %{http_code}\n' -X POST "$BASE/api/labels/pdf/task" -H 'Content-Type: application/json' -d ''
head -c 120 /tmp/r3.json; echo

echo "== 4) журнал: события за последние 10 минут =="
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const rows = db.prepare(\"SELECT id, level, source, event, message, status FROM app_logs WHERE created_at > datetime('now','-10 minutes') ORDER BY id DESC LIMIT 10\").all();
console.log(JSON.stringify(rows, null, 1));
"
rm -f /tmp/r1.json /tmp/r2.json /tmp/r3.json
