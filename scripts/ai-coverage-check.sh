#!/usr/bin/env bash
# Проверка покрытия проблемных сценариев AI-помощником.
set -uo pipefail
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_ai2_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"

ask() {
  local page="$1" msg="$2" label="$3"
  local body
  body=$(node -e "console.log(JSON.stringify({ page: process.argv[1], message: process.argv[2] }))" "$page" "$msg")
  curl -sS -b "$CJ" -X POST "$BASE/api/assistant/chat" \
    -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' \
    -d "$body" -o /tmp/cq_ai2.json -m 120 -w "HTTP %{http_code} — $label\n"
  node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/cq_ai2.json','utf8'));
const a = String(d.answer || d.error || '');
console.log('  len=' + a.length + ' needHuman=' + d.needHuman + ' | ' + a.slice(0, 380).replace(/\\s+/g,' '));
"
}

ask reprint "Не читается код сканером, что проверить?" "сканер не читает"
ask security "Не приходит письмо для сброса пароля" "письмо не приходит"
ask security "Не могу войти, включена 2FA, телефон потерян" "вход с 2FA"
ask generate "Задание зависло в очереди, что делать?" "задание зависло"
ask overview "Сколько кодов я потратил сегодня и какой у меня лимит?" "остаток лимита"
ask generate "Как интегрировать сервис с 1С?" "интеграция 1С"
ask labels "Принтер печатает пустые этикетки" "пустые этикетки"
ask apikeys "API возвращает 401, что делать?" "ошибка API 401"
ask billing "Оплата прошла, а premium не активировался" "оплата без активации"

rm -f "$CJ" /tmp/cq_ai2.json
