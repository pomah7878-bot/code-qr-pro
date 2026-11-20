#!/usr/bin/env bash
# Устанавливает Node 24 (LTS) в /opt/node24 и DSH (@deepseek-ai/dsh) рядом с ним.
# Системный Node 20 и сайт не трогаем: DSH запускается отдельным бинарником.
set -euo pipefail

DSH_VERSION="${DSH_VERSION:-0.2.2-rc.5}"
NODE_DIR=/opt/node24

if [ -x "$NODE_DIR/bin/node" ]; then
  echo "node24 already installed: $($NODE_DIR/bin/node -v)"
else
  echo "== resolving latest Node 24 =="
  curl -sS https://nodejs.org/dist/index.json -o /tmp/node-index.json
  NODE_VER=$(node -e "
    const j = JSON.parse(require('fs').readFileSync('/tmp/node-index.json', 'utf8'));
    const v24 = j.filter((x) => x.version.startsWith('v24.')).map((x) => x.version).sort((a, b) => {
      const pa = a.slice(1).split('.').map(Number), pb = b.slice(1).split('.').map(Number);
      return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
    });
    console.log(v24[0]);
  ")
  echo "node version: $NODE_VER"
  echo "== downloading =="
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz" -o /tmp/node24.tar.xz
  mkdir -p /opt
  rm -rf "$NODE_DIR"
  tar -xJf /tmp/node24.tar.xz -C /opt
  mv "/opt/node-$NODE_VER-linux-x64" "$NODE_DIR"
  rm -f /tmp/node24.tar.xz /tmp/node-index.json
  echo "node24 installed: $($NODE_DIR/bin/node -v)"
fi

echo "== install dsh $DSH_VERSION =="
"$NODE_DIR/bin/npm" install -g "@deepseek-ai/dsh@$DSH_VERSION" --no-audit --no-fund 2>&1 | tail -5

echo "== wrapper /usr/local/bin/dsh =="
cat > /usr/local/bin/dsh <<EOF
#!/bin/sh
exec $NODE_DIR/bin/node $NODE_DIR/lib/node_modules/@deepseek-ai/dsh/lib/bin.js "\$@"
EOF
chmod 755 /usr/local/bin/dsh

echo "== check =="
/usr/local/bin/dsh --version
echo "ok"
