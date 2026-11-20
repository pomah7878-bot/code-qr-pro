#!/usr/bin/env bash
# Проверяет, что помощник не «закидывает вопросами»: на уточнения отвечает шагами.
set -uo pipefail
cd /opt/code-qr/server

BASE="https://code-qr.stockcity.ru"
ORIGIN="Origin: https://code-qr.stockcity.ru"
STAMP=$(date +%s)
EMAIL="qa-help-$STAMP@example.com"
TOKEN="h$STAMP$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node -e "
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const db = new Database('data/app.db');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('Testpass12345', salt, 64).toString('hex');
const id = db.prepare('INSERT INTO users (email, password_hash, name, role, plan) VALUES (?,?,?,?,?)')
  .run(process.argv[1], salt + ':' + hash, 'QA help', 'user', 'premium').lastInsertRowid;
db.prepare(\"INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at) VALUES (?, 'premium', 'active', 'test', datetime('now'), datetime('now','+30 days'))\").run(id);
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
  .run(process.argv[2], crypto.randomBytes(16).toString('hex'), id, new Date(Date.now() + 86400_000).toISOString(), '127.0.0.1', 'qa');
console.log(id);
" "$EMAIL" "$TOKEN" > /tmp/help-uid.txt
UID_=$(cat /tmp/help-uid.txt)

ask() {
  local payload="$1"
  curl -sS -X POST "$BASE/api/assistant/chat" -H "Cookie: cq_session=$TOKEN" -H "$ORIGIN" -H 'Content-Type: application/json' \
    -d "$payload" -o /tmp/help-ans.json -w ' [%{http_code}]'
  node -e "
    const fs = require('node:fs');
    const d = JSON.parse(fs.readFileSync('/tmp/help-ans.json', 'utf8'));
    console.log(JSON.stringify({
      clarify: d.clarify === true,
      needHuman: d.needHuman === true,
      answer: String(d.answer || '').replace(/\s+/g, ' ').slice(0, 220),
      sources: (d.sources || []).length,
      error: d.error || null
    }));
  "
}

echo "== 1) очень короткий первый вопрос =="
ask '{"message":"не работает","page":"labels"}'

echo "== 2) уточнение с историей (должен отвечать шагами) =="
ask '{"message":"этикетки не печатаются, PDF не скачивается с телефона","page":"labels","history":[{"role":"user","text":"не работает"},{"role":"assistant","text":"Уточните, что именно не работает: генерация, этикетки или печать?"}]}'

echo "== 3) продолжение «не помогло» (не должен переспрашивать) =="
ask '{"message":"сделал как вы сказали, всё равно не печатается","page":"labels","history":[{"role":"user","text":"этикетки не печатаются, PDF не скачивается"},{"role":"assistant","text":"Проверьте масштаб 100% и размер бумаги 58x40"},{"role":"user","text":"сделал, всё равно не печатается"}]}'

echo "== 4) обычный вопрос сразу =="
ask '{"message":"как перепечатать этикетки из истории?","page":"reprint"}'

echo "== cleanup =="
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const id = Number(process.argv[1]);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
db.prepare('DELETE FROM rate_limits WHERE key IN (?,?)').run('ai-support:u' + id, 'ai-ticket:u' + id);
db.prepare('DELETE FROM users WHERE id=?').run(id);
console.log('cleanup done');
" "$UID_"
rm -f /tmp/help-uid.txt /tmp/help-ans.json
