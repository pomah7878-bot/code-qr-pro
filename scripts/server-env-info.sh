#!/usr/bin/env bash
set -uo pipefail
. /etc/os-release 2>/dev/null || true
echo "os=${PRETTY_NAME:-unknown}"
echo "arch=$(uname -m)"
echo "node=$(node -v)"
echo "npm=$(npm -v)"
echo "home_codeqr=$(getent passwd codeqr | cut -d: -f6)"
echo "service_home_env=$(systemctl show code-qr -p Environment | tr ' ' '\n' | grep -c '^HOME=' || true)"
echo "dsh_present=$(command -v dsh || echo no)"
echo "node24_present=$(test -x /opt/node24/bin/node && /opt/node24/bin/node -v || echo no)"
