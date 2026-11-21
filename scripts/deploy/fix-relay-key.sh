#!/usr/bin/env bash
# Аккуратно чиним строку ключа туннеля в authorized_keys (кавычки у permitopen).
set -euo pipefail
python3 - <<'PY'
p = '/root/.ssh/authorized_keys'
s = open(p).read()
s = s.replace('permitopen=127.0.0.1:3110', 'permitopen="127.0.0.1:3110"')
open(p, 'w').write(s)
for line in s.splitlines():
    if 'VM-485098' in line:
        print(line[:120])
PY
