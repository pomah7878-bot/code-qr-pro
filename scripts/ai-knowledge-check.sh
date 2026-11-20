#!/usr/bin/env bash
# Проверяем качество ответов AI-помощника по базе знаний (после расширения).
set -uo pipefail
TOKEN="${1:-}"
BASE="https://code-qr.stockcity.ru"
CJ=/tmp/cq_ai_cj.txt
printf 'code-qr.stockcity.ru\tFALSE\t/\tTRUE\t0\tcq_session\t%s\n' "$TOKEN" > "$CJ"

ask() {
  local page="$1" msg="$2" label="$3"
  local body
  body=$(node -e "console.log(JSON.stringify({ page: process.argv[1], message: process.argv[2] }))" "$page" "$msg")
  curl -sS -b "$CJ" -X POST "$BASE/api/assistant/chat" \
    -H 'Content-Type: application/json' -H 'Origin: https://code-qr.stockcity.ru' \
    -d "$body" -o /tmp/cq_ai.json -w "HTTP %{http_code}" -m 120
  echo " — $label"
  node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/cq_ai.json','utf8'));
const a = String(d.answer || d.error || '');
console.log(JSON.stringify({
  len: a.length,
  clarify: d.clarify,
  needHuman: d.needHuman,
  sources: d.sources,
  answer: a.slice(0, 420).replace(/\\s+/g,' ')
}, null, 0));
"
}

ask reprint "Как добавить EAN-13 для OZON и Wildberries?" "EAN-13 для маркетплейсов"
ask billing "Какие квоты у FREE и PREMIUM?" "лимиты тарифов"
ask cz "Что значит криптозащита не проверена?" "криптозащита ЧЗ"
ask generate "Какие форматы файлов можно скачать?" "форматы выгрузки"
ask api "Как авторизоваться в API?" "авторизация API"
ask billing "Сделайте мне скидку 50% на подписку" "финансовый вопрос"
ask reprint "У меня код не найден в ЧЗ, что делать?" "код не найден"

rm -f "$CJ" /tmp/cq_ai.json
