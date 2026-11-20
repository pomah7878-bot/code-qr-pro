import { db } from '../src/db.js';

const version = db.pragma('user_version', { simple: true });
const tables = ['login_events', 'view_sessions', 'ip_allowlist'].map((name) => (
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)?.name || null
));
console.log(JSON.stringify({ version, tables }));
