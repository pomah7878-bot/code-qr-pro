#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const total = db.prepare('SELECT COUNT(*) c FROM kb_articles').get().c;
console.log('kb_articles:', total);
const rows = db.prepare('SELECT slug, title FROM kb_articles ORDER BY slug').all();
console.log(rows.map(r => r.slug).join(', '));
"
