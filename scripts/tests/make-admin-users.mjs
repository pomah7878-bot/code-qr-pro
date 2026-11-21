import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

const DB_PATH = '/opt/code-qr/server/data/app.db';
const db = new Database(DB_PATH);
const BASE = 'https://code-qr.stockcity.ru';
const email = `qa-admin-${Date.now()}@example.com`;
const supportEmail = `qa-support-${Date.now()}@example.com`;

function create(email, role) {
  const token = 'a' + randomBytes(24).toString('hex');
  const id = db.prepare("INSERT INTO users (email, password_hash, name, role, plan, totp_enabled, totp_secret) VALUES (?, 'x', 'QA Admin', ?, 'pro', 1, 'JBSWY3DPEHPK3PXP')")
    .run(email, role).lastInsertRowid;
  db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .run(token, randomBytes(8).toString('hex'), id, new Date(Date.now() + 86400000).toISOString(), '127.0.0.1', 'qa-admin');
  return { id, email, token };
}
const admin = create(email, 'admin');
const support = create(supportEmail, 'support');
// активная подписка для прав
db.prepare("INSERT INTO subscriptions (user_id, plan, status, provider, started_at, expires_at, source) VALUES (?, 'pro', 'active', 'qa', datetime('now'), datetime('now','+30 days'), 'admin')")
  .run(admin.id);
console.log(JSON.stringify({ admin, support }));
