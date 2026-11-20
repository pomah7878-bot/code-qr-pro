#!/usr/bin/env bash
set -uo pipefail
cd /opt/code-qr/server
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/app.db');
const ins = db.prepare(\"INSERT INTO app_logs (level, source, event, message, method, url, status) VALUES ('error','server','qa_ui','Тестовая ошибка для проверки очистки','GET','/api/qa',500)\");
for (let i = 0; i < 5; i++) ins.run();
console.log('seeded 5 logs');
console.log('total now:', db.prepare('SELECT COUNT(*) c FROM app_logs').get().c);
"
