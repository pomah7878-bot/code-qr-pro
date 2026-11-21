import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

const DB_PATH = '/opt/code-qr/server/data/app.db';
const db = new Database(DB_PATH);
const BASE = 'https://code-qr.stockcity.ru';
const sqlNow = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

function create(plan, role, totp = false) {
  const email = `qa-ui-${Date.now()}-${randomBytes(3).toString('hex')}@example.com`;
  const token = 'u' + randomBytes(24).toString('hex');
  const id = db.prepare("INSERT INTO users (email, password_hash, name, role, plan, totp_enabled, totp_secret) VALUES (?, 'x', 'QA UI', ?, ?, ?, ?)")
    .run(email, role, plan, totp ? 1 : 0, totp ? 'JBSWY3DPEHPK3PXP' : null).lastInsertRowid;
  db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .run(token, randomBytes(8).toString('hex'), id, new Date(Date.now() + 86400000).toISOString(), '127.0.0.1', 'qa-ui');
  return { id, email, token };
}

const free = create('free', 'user');
const admin = create('free', 'admin', true);
// бесплатному пользователю включаем триал через API (проверяем реальный серверный флоу)
const trialRes = await fetch(BASE + '/api/billing/trial', {
  method: 'POST',
  headers: { Cookie: `cq_session=${free.token}`, 'Content-Type': 'application/json', Origin: BASE },
  body: '{}'
});
console.log(JSON.stringify({ free, admin, trialStatus: trialRes.status, created: Date.now() }));
