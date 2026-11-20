#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server

KEY=$(sed -n 's/^DEEPSEEK_API_KEY=//p' .env)
echo "env key length: ${#KEY}"

echo "== DeepSeek balance (env key) =="
curl -sS -m 20 https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer $KEY" \
  -o /tmp/ds-balance.json -w 'balance: %{http_code}\n'
cat /tmp/ds-balance.json; echo

echo "== Kilo models free count =="
curl -sS -m 20 https://api.kilo.ai/api/gateway/models -o /tmp/kilo-models.json -w 'models: %{http_code}\n'
node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync('/tmp/kilo-models.json', 'utf8'));
const data = Array.isArray(j.data) ? j.data : [];
const free = data.filter((m) => m.isFree === true || /free/i.test(String(m.id)));
console.log(JSON.stringify({ total: data.length, free: free.length, sample: free.slice(0, 5).map((m) => m.id) }));
"
rm -f /tmp/ds-balance.json /tmp/kilo-models.json
