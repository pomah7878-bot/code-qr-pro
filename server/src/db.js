import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, '..', 'data', 'app.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const MIGRATIONS = [
  // v1 — Foundation
  `CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    plan TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE usage_daily (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    codes_generated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT,
    external_id TEXT,
    started_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
  // v2 — DataMatrix Engine
  `CREATE TABLE generation_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'cz',
    format TEXT NOT NULL DEFAULT 'png',
    status TEXT NOT NULL DEFAULT 'queued',
    total INTEGER NOT NULL DEFAULT 0,
    valid INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE INDEX idx_jobs_user ON generation_jobs(user_id);
  CREATE TABLE job_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    raw TEXT NOT NULL,
    normalized TEXT,
    gtin TEXT,
    serial TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    error TEXT
  );
  CREATE INDEX idx_job_items_job ON job_items(job_id);`,
  // v3 — Label & Print
  `CREATE TABLE label_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    width_mm REAL NOT NULL,
    height_mm REAL NOT NULL,
    dpi INTEGER NOT NULL DEFAULT 203,
    elements TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_templates_user ON label_templates(user_id);`
];

const version = db.pragma('user_version', { simple: true });
for (let i = version; i < MIGRATIONS.length; i++) {
  db.exec('BEGIN');
  try {
    db.exec(MIGRATIONS[i]);
    db.pragma(`user_version = ${i + 1}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function usageToday(userId) {
  const row = db.prepare('SELECT codes_generated FROM usage_daily WHERE user_id = ? AND day = ?').get(userId, today());
  return row ? row.codes_generated : 0;
}
