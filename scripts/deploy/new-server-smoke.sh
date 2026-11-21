#!/usr/bin/env bash
# Смоук-тест сайта на новом сервере ДО переключения DNS (через --resolve).
set -uo pipefail
cd /opt/code-qr/server
BASE="https://code-qr.stockcity.ru"
RESOLVE="code-qr.stockcity.ru:443:212.22.82.151"

node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const { randomBytes } = require('node:crypto');
const stamp = Date.now();
const email = 'qa-migrate-' + stamp + '@example.com';
const token = 'm' + randomBytes(24).toString('hex');
const id = db.prepare(\"INSERT INTO users (email, password_hash, name, role, plan) VALUES (?,?,?, 'user', 'premium')\").run(email, 'x', 'QA migrate').lastInsertRowid;
db.prepare(\"INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?, '127.0.0.1','qa', datetime('now'))\").run(token, randomBytes(8).toString('hex'), id, new Date(Date.now()+86400000).toISOString());
console.log('TOKEN=' + token);
console.log('USER_ID=' + id);
console.log('EMAIL=' + email);
" > /tmp/smoke-user.txt
TOKEN=$(grep '^TOKEN=' /tmp/smoke-user.txt | cut -d= -f2)
CID=$(grep '^USER_ID=' /tmp/smoke-user.txt | cut -d= -f2)
echo "test user: $CID"

echo "=== health / me ==="
curl -sS -m 15 --resolve $RESOLVE "$BASE/api/health"; echo
curl -sS -m 15 --resolve $RESOLVE -b "cq_session=$TOKEN" "$BASE/api/me" -o /tmp/me.json -w 'me: %{http_code}\n'
node -e "const d=require('/tmp/me.json');console.log('plan:', d.plan && d.plan.id, 'email:', d.user && d.user.email)"

echo "=== product card (server-side ЧЗ) ==="
curl -sS -m 30 --resolve $RESOLVE -b "cq_session=$TOKEN" -X POST "$BASE/api/product/cards" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"codes":[{"code":"0104638230913287215ZsWrd","gtin":""}]}' -o /tmp/cards.json -w 'cards: %{http_code}\n'
node -e "const d=require('/tmp/cards.json');const c=d.cards&&d.cards[0];console.log(JSON.stringify({found:!!(c&&c.card),name:c&&c.card&&c.card.name,source:c&&c.card&&c.card.sourceLabel,status:c&&c.card&&c.card.status,production:c&&c.card&&c.card.productionDate,expiry:c&&c.card&&c.card.expirationDate,images:c&&c.card&&c.card.images}))"

echo "=== AI assistant chat (free via relay) ==="
curl -sS -m 90 --resolve $RESOLVE -b "cq_session=$TOKEN" -X POST "$BASE/api/assistant/chat" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"page":"reprint","message":"Как добавить EAN-13 для OZON?"}' -o /tmp/ai.json -w 'chat: %{http_code}\n'
node -e "const d=require('/tmp/ai.json');console.log(JSON.stringify({len:(d.answer||'').length,model:d.model,clarify:d.clarify,needHuman:d.needHuman,answer:(d.answer||d.error||'').slice(0,140)}))"

echo "=== ticket -> telegram from new server ==="
curl -sS -m 20 --resolve $RESOLVE -b "cq_session=$TOKEN" -X POST "$BASE/api/assistant/tickets" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"subject":"QA миграция: тест уведомления","message":"Проверка Telegram с нового сервера после миграции."}' -o /tmp/ticket.json -w 'ticket: %{http_code}\n'
cat /tmp/ticket.json; echo
sleep 2
journalctl -u code-qr --since '-2 min' --no-pager | grep -i 'telegram' | tail -3 || echo 'telegram: no errors'

echo "=== labels PDF + print HTML ==="
BODY='{"template":{"name":"QA 58x40","widthMm":58,"heightMm":40,"dpi":203,"elements":[{"id":"dm","type":"datamatrix","x":2,"y":2,"w":18,"h":18},{"id":"capGtin","type":"field","field":"gtin","x":2,"y":22,"w":54,"h":3},{"id":"capSerial","type":"field","field":"serialAi","x":2,"y":25.5,"w":54,"h":3}]},"rows":[{"code":"0104638230913287215ZsWrd","gtin":"04638230913287","serial":"5ZsWrd","serialAi":"21 5ZsWrd"}],"single":true,"source":"reprint"}'
curl -sS -m 30 --resolve $RESOLVE -b "cq_session=$TOKEN" -X POST "$BASE/api/labels/pdf/ticket" -H 'Content-Type: application/json' -H "Origin: $BASE" -d "$BODY" -o /tmp/ticketpdf.json -w 'pdf ticket: %{http_code}\n'
URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/ticketpdf.json','utf8')).url||'')}catch(e){console.log('')}")
if [ -n "$URL" ]; then curl -sS -m 30 --resolve $RESOLVE -b "cq_session=$TOKEN" "$BASE$URL" -o /tmp/label.pdf -w 'pdf file: %{http_code} type=%{content_type} size=%{size_download}\n'; head -c 5 /tmp/label.pdf; echo; fi
curl -sS -m 30 --resolve $RESOLVE -b "cq_session=$TOKEN" -X POST "$BASE/api/labels/print" -H 'Content-Type: application/json' -H "Origin: $BASE" -d "$BODY" -o /tmp/print.html -w 'print html: %{http_code} size=%{size_download}\n'
grep -o 'data-print' /tmp/print.html | head -1

echo "=== yookassa reachability ==="
curl -4 -sS -m 10 -o /dev/null -w 'yookassa: %{http_code}\n' https://api.yookassa.ru/v3/me || true

echo "=== backup service ==="
systemctl start code-qr-backup.service && sleep 2
systemctl status code-qr-backup.service --no-pager -n 3 | tail -4
ls -la /opt/backups/code-qr | tail -3

echo "=== cleanup test user ==="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const id = Number(process.argv[1]);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
db.prepare('DELETE FROM support_tickets WHERE user_id=?').run(id);
db.prepare('DELETE FROM users WHERE id=?').run(id);
console.log('removed user', id);
" "$CID"
echo SMOKE_DONE
