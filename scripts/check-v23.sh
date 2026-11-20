#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
console.log('version:', db.pragma('user_version', { simple: true }));
const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
console.log('premium_notice_at:', cols.includes('premium_notice_at'));
console.log('logo mode:', db.prepare(\"SELECT value FROM app_settings WHERE key='email_logo_mode'\").get() || 'default(image)');
"
