import { db } from '../src/db.js';

const version = db.pragma('user_version', { simple: true });
const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='login_links'").get();
const index = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_login_links_user'").get();
console.log(JSON.stringify({ version, loginLinks: Boolean(table), index: Boolean(index) }));
