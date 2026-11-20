#!/usr/bin/env bash
# Ставит DSH в отдельный префикс /opt/dsh под Node 24 и создаёт обёртку /usr/local/bin/dsh.
set -euo pipefail

export PATH=/opt/node24/bin:$PATH
echo "node=$(node -v) npm=$(npm -v)"

mkdir -p /opt/dsh
npm install -g --prefix /opt/dsh \
  --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs \
  @deepseek-ai/dsh@0.2.2-rc.5 --no-audit --no-fund 2>&1 | tail -6

cat > /usr/local/bin/dsh <<'EOF'
#!/bin/sh
exec /opt/node24/bin/node /opt/dsh/lib/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"
EOF
chmod 755 /usr/local/bin/dsh

echo "== check =="
/usr/local/bin/dsh --version
