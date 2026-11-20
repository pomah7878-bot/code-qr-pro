#!/usr/bin/env bash
# Убирает всё после тестов AI: мок-процесс, настройки, тестовых пользователей.
set -uo pipefail
cd /opt/code-qr/server

pkill -f 'mock-llm.mjs' 2>/dev/null || true
rm -f /tmp/ai-prompt.txt /tmp/ai-prompt-ui.txt /tmp/mock-llm.log /tmp/mock-llm-ui.log

node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
for (const k of ['ai_api_key','ai_base_url','ai_model','ai_max_tokens','ai_backend','ai_enabled']) {
  db.prepare('DELETE FROM app_settings WHERE key=?').run(k);
}
const ids = db.prepare(\"SELECT id FROM users WHERE email LIKE 'qa-%@example.com' OR email LIKE 'mob-%@example.com'\").all().map((r) => r.id);
for (const id of ids) {
  db.prepare('DELETE FROM ai_queries WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM login_events WHERE user_id=?').run(id);
  db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
}
db.prepare(\"DELETE FROM app_logs WHERE source='ai'\").run();
console.log(JSON.stringify({ removedUsers: ids.length, aiLeft: db.prepare('SELECT COUNT(*) c FROM ai_queries').get().c, aiSettings: db.prepare(\"SELECT COUNT(*) c FROM app_settings WHERE key LIKE 'ai_%'\").get().c }));
"
