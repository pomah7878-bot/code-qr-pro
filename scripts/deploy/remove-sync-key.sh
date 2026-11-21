#!/usr/bin/env bash
# Убирает временный ключ синхронизации (old->new) после успешного переключения.
set -euo pipefail
NEW_PUB="$(ssh -i /root/.ssh/sync_tmp_ed25519 -o StrictHostKeyChecking=no root@212.22.82.151 'echo ok' >/dev/null 2>&1 && echo yes || echo no)"
echo "old->new key works: $NEW_PUB"
python3 - <<'PY'
import os
p = '/root/.ssh/authorized_keys'
if not os.path.exists(p):
    raise SystemExit('no authorized_keys')
lines = open(p).read().splitlines()
# ключ, принадлежащий старому серверу (sync_tmp), начинается с ssh-ed25519 и комментом root@VM-518939
keep = [l for l in lines if 'root@VM-518939' not in l or 'restrict' in l]
removed = len(lines) - len(keep)
open(p, 'w').write('\n'.join(keep) + ('\n' if keep else ''))
print('removed key lines:', removed)
PY
