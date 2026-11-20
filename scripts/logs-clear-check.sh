#!/usr/bin/env bash
# Проверка очистки журнала ошибок: всё, по возрасту, одна запись, права.
set -uo pipefail
cd /opt/code-qr/server
BASE="https://code-qr.stockcity.ru"
TOKEN_A="${1:-}"
TOKEN_C="${2:-}"
CJ=/tmp/cq_logs_cj.txt
rm -f "$CJ"
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN_A" > "$CJ"

node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const ins = db.prepare(\"INSERT INTO app_logs (level, source, event, message, method, url, status) VALUES ('error','server','qa_test','QA log entry','ADMIN','/api/qa/test',500)\");
const ids = [];
for (let i = 0; i < 3; i++) ids.push(ins.run().lastInsertRowid);
db.prepare(\"UPDATE app_logs SET created_at = datetime('now','-40 days') WHERE id = ?\").run(ids[0]);
console.log('seeded ids:', ids.join(','));
"

echo "== total before =="
curl -sS -b "$CJ" "$BASE/api/admin/logs?days=90" -o /tmp/cq_logs.json -w 'get: %{http_code}\n'
node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/cq_logs.json','utf8'));console.log('total:', d.total, 'counts:', JSON.stringify(d.counts))"

echo "== clear older than 1 day =="
curl -sS -b "$CJ" -X DELETE "$BASE/api/admin/logs" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' -d '{"days":1}' -o /tmp/cq_clear1.json -w 'clear-old: %{http_code}\n'
cat /tmp/cq_clear1.json; echo

echo "== clear all =="
curl -sS -b "$CJ" -X DELETE "$BASE/api/admin/logs" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' -d '{"all":true}' -o /tmp/cq_clear2.json -w 'clear-all: %{http_code}\n'
cat /tmp/cq_clear2.json; echo

echo "== total after clear =="
curl -sS -b "$CJ" "$BASE/api/admin/logs?days=90" -o /tmp/cq_logs2.json -w 'get: %{http_code}\n'
node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/cq_logs2.json','utf8'));console.log('total:', d.total)"

echo "== delete single =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log('new id:', db.prepare(\"INSERT INTO app_logs (level, source, event, message) VALUES ('warn','server','qa_one','single entry')\").run().lastInsertRowid);
" > /tmp/cq_newid.txt
NEWID=$(sed -n 's/.*new id: //p' /tmp/cq_newid.txt)
curl -sS -b "$CJ" -X DELETE "$BASE/api/admin/logs/$NEWID" -H 'Origin: https://code-qr.stockcity.ru' -o /tmp/cq_del_one.json -w "delete-one($NEWID): %{http_code}\n"
cat /tmp/cq_del_one.json; echo
curl -sS -b "$CJ" "$BASE/api/admin/logs?days=90" -o /tmp/cq_logs3.json -w 'get: %{http_code}\n'
node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/cq_logs3.json','utf8'));console.log('total:', d.total)"

echo "== права =="
curl -sS -o /dev/null -w 'noauth clear-all: %{http_code}\n' -X DELETE "$BASE/api/admin/logs" -H 'Content-Type: application/json' -d '{"all":true}'
if [ -n "$TOKEN_C" ]; then
  printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN_C" > /tmp/cq_logs_c.txt
  curl -sS -b /tmp/cq_logs_c.txt -o /dev/null -w 'client clear-all: %{http_code}\n' -X DELETE "$BASE/api/admin/logs" -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' -d '{"all":true}'
  rm -f /tmp/cq_logs_c.txt
fi

rm -f "$CJ" /tmp/cq_logs*.json /tmp/cq_clear*.json /tmp/cq_del_one.json /tmp/cq_newid.txt
