#!/usr/bin/env bash
set -uo pipefail
echo "== models list =="
curl -sS -m 20 https://api.kilo.ai/api/gateway/models -o /tmp/kilo-models.json -w 'models: %{http_code} size=%{size_download}\n'
node -e "
const fs = require('node:fs');
try {
  const j = JSON.parse(fs.readFileSync('/tmp/kilo-models.json', 'utf8'));
  const data = Array.isArray(j.data) ? j.data : [];
  const free = data.filter((m) => m.isFree === true || /free/i.test(String(m.id)));
  console.log('total:', data.length, 'free:', free.length);
  console.log(free.slice(0, 12).map((m) => m.id).join(', '));
} catch (e) {
  console.log('parse error:', e.message);
}
"

echo "== chat kilo-auto/free =="
curl -sS -m 120 -X POST https://api.kilo.ai/api/gateway/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"kilo-auto/free","messages":[{"role":"user","content":"Ответь одним словом: ок"}],"max_tokens":20,"stream":false}' \
  -o /tmp/kilo-chat.json -w 'chat: %{http_code} size=%{size_download}\n'
head -c 600 /tmp/kilo-chat.json; echo
rm -f /tmp/kilo-models.json /tmp/kilo-chat.json
