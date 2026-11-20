#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log('tickets:', JSON.stringify(db.prepare('SELECT id, status, subject, created_at FROM support_tickets ORDER BY id DESC LIMIT 5').all()));
console.log('kb mobile-print:', JSON.stringify(db.prepare(\"SELECT slug, substr(body,1,60) s, updated_at FROM kb_articles WHERE slug='mobile-print'\").get()));
"
