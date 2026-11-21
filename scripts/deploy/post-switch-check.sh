#!/usr/bin/env bash
# Пост-миграционная проверка (запускать НА НОВОМ сервере после смены DNS).
set -uo pipefail
cd /opt/code-qr/server
BASE="https://code-qr.stockcity.ru"

echo "=== DNS ==="
getent hosts code-qr.stockcity.ru
echo "=== HTTPS/health ==="
curl -sS -m 15 -o /tmp/post-home.html -w 'home: %{http_code} %{size_download}b\n' "$BASE/"
curl -sS -m 10 -w '\nhealth: %{http_code}\n' "$BASE/api/health"
echo "=== cert ==="
echo | openssl s_client -connect code-qr.stockcity.ru:443 -servername code-qr.stockcity.ru 2>/dev/null | openssl x509 -noout -dates -issuer 2>/dev/null | head -3

echo "=== test user ==="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const { randomBytes } = require('node:crypto');
const token = 'p' + randomBytes(24).toString('hex');
const email = 'qa-post-' + Date.now() + '@example.com';
const id = db.prepare(\"INSERT INTO users (email, password_hash, name, role, plan) VALUES (?,?,?, 'user', 'premium')\").run(email, 'x', 'QA post').lastInsertRowid;
db.prepare(\"INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?, '127.0.0.1','qa', datetime('now'))\").run(token, randomBytes(8).toString('hex'), id, new Date(Date.now()+86400000).toISOString());
require('fs').writeFileSync('/tmp/post-user.txt', token + '\n' + id + '\n');
console.log('created user', id, email);
"
TOKEN=$(head -1 /tmp/post-user.txt); UID=$(tail -1 /tmp/post-user.txt)

echo "=== me / assistant / product card / labels / print ==="
curl -sS -m 15 -b "cq_session=$TOKEN" "$BASE/api/me" -o /tmp/post-me.json -w 'me: %{http_code}\n'
node -e "const d=require('/tmp/post-me.json');console.log('plan:', d.plan&&d.plan.id)"

curl -sS -m 90 -b "cq_session=$TOKEN" -X POST "$BASE/api/assistant/chat" -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"page":"overview","message":"Сколько кодов в день на моём тарифе?"}' -o /tmp/post-ai.json -w 'ai: %{http_code}\n'
node -e "const d=require('/tmp/post-ai.json');console.log(JSON.stringify({len:(d.answer||'').length,model:d.model,answer:(d.answer||d.error||'').slice(0,120)}))"

CODE=$(node -e "console.log('0104638230913287215ZsWrd' + String.fromCharCode(29) + '91EE12' + String.fromCharCode(29) + '92f2+hPGe2ZRc2FmzC1oFm+6Nwt1PxgpCRp9khyOKEEG4w=')")
BODY=$(node -e "console.log(JSON.stringify({codes:[{code:process.argv[1],gtin:''}]}))" "$CODE")
curl -sS -m 40 -b "cq_session=$TOKEN" -X POST "$BASE/api/product/cards" -H 'Content-Type: application/json' -H "Origin: $BASE" -d "$BODY" -o /tmp/post-card.json -w 'card: %{http_code}\n'
node -e "const d=require('/tmp/post-card.json');const c=d.cards&&d.cards[0];console.log(JSON.stringify({found:!!(c&&c.card),name:c&&c.card&&c.card.name,status:c&&c.card&&c.card.status}))"

TPL='{"template":{"name":"QA","widthMm":58,"heightMm":40,"dpi":203,"elements":[{"id":"dm","type":"datamatrix","x":2,"y":2,"w":18,"h":18}]},"rows":[{"code":"0104638230913287215ZsWrd","gtin":"04638230913287","serial":"5ZsWrd","serialAi":"21 5ZsWrd"}],"single":true,"source":"reprint"}'
curl -sS -m 30 -b "cq_session=$TOKEN" -X POST "$BASE/api/labels/pdf/ticket" -H 'Content-Type: application/json' -H "Origin: $BASE" -d "$TPL" -o /tmp/post-pdf.json -w 'pdf ticket: %{http_code}\n'
URL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/post-pdf.json','utf8')).url||'')}catch(e){console.log('')}")
[ -n "$URL" ] && curl -sS -m 30 -b "cq_session=$TOKEN" "$BASE$URL" -o /tmp/post-label.pdf -w 'pdf file: %{http_code} %{content_type} %{size_download}b\n'

echo "=== services / errors ==="
systemctl is-active code-qr ai-relay-tunnel nginx
journalctl -u code-qr --since '-10 min' --no-pager | grep -Ei '"level":(50|60)' | tail -5 || echo 'no error logs'

echo "=== cleanup ==="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const id = Number(process.argv[1]);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
db.prepare('DELETE FROM users WHERE id=?').run(id);
console.log('removed test user', id);
" "$UID"
echo POST_CHECK_DONE
