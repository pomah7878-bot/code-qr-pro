#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const soon = db.prepare(\`
  SELECT COUNT(*) c FROM users u JOIN subscriptions s ON s.user_id=u.id
  WHERE u.plan='premium' AND u.status='active' AND s.status='active'
    AND s.expires_at > datetime('now') AND s.expires_at <= datetime('now','+3 days')
    AND (u.premium_notice_at IS NULL OR u.premium_notice_at < datetime('now','-3 days'))
\`).get().c;
const expired = db.prepare(\`
  SELECT COUNT(*) c FROM users u WHERE u.plan='premium' AND u.id NOT IN (
    SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > datetime('now')
  )
\`).get().c;
console.log(JSON.stringify({ expiringSoon: soon, premiumWithoutActiveSub: expired }));
"
