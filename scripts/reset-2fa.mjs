// Аварийное отключение 2FA: node scripts/reset-2fa.mjs admin@example.com
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Database = require('better-sqlite3');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Укажите email: node scripts/reset-2fa.mjs user@example.com');
  process.exit(1);
}

const dbPath = process.env.DB_PATH || fileURLToPath(new URL('../server/data/app.db', import.meta.url));
const db = new Database(dbPath);
const user = db.prepare('SELECT id, email FROM users WHERE email=?').get(email);
if (!user) {
  console.error('Пользователь не найден:', email);
  process.exit(1);
}
db.prepare("UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup='[]' WHERE id=?").run(user.id);
db.prepare("INSERT INTO audit_log (actor_email, actor_role, action, target_type, target_id, meta, ip) VALUES (?,?,?,?,?,?,?)")
  .run('cli', 'system', '2fa.reset_cli', 'user', String(user.id), JSON.stringify({ email }), '');
console.log('2FA отключена для', user.email, '(id', user.id + ')');
db.close();
