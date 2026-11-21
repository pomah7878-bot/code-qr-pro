import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

const DB_PATH = '/opt/code-qr/server/data/app.db';
const db = new Database(DB_PATH);
const BASE = 'https://code-qr.stockcity.ru';
const email = `qa-mobile-${Date.now()}@example.com`;
const token = 'm' + randomBytes(24).toString('hex');
const id = db.prepare("INSERT INTO users (email, password_hash, name, role, plan) VALUES (?, 'x', 'QA Mobile', 'user', 'free')").run(email).lastInsertRowid;
db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
  .run(token, randomBytes(8).toString('hex'), id, new Date(Date.now() + 86400000).toISOString(), '127.0.0.1', 'qa-mobile');
const res = await fetch(BASE + '/api/billing/trial', {
  method: 'POST',
  headers: { Cookie: `cq_session=${token}`, 'Content-Type': 'application/json', Origin: BASE },
  body: '{}'
});
console.log(JSON.stringify({ id, email, token, trial: res.status }));
