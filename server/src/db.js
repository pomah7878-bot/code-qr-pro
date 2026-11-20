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
  CREATE INDEX idx_templates_user ON label_templates(user_id);`,
  // v4 — Billing & API
  `CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT NOT NULL DEFAULT 'yookassa',
    external_id TEXT,
    confirmation_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT
  );
  CREATE INDEX idx_orders_user ON orders(user_id);
  CREATE INDEX idx_orders_status ON orders(status);
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );`,
  // v5 — редактируемые тарифы: срок подписки в заказе
  `ALTER TABLE orders ADD COLUMN days INTEGER NOT NULL DEFAULT 30;`,
  // v6 — отзывы клиентов
  `CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_reviews_status ON reviews(status);`,
  // v7 — админка: блокировка, заметки, история входов, индексы для фильтров
  `ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
   ALTER TABLE users ADD COLUMN blocked_at TEXT;
   ALTER TABLE users ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
   ALTER TABLE users ADD COLUMN last_login_at TEXT;
   ALTER TABLE users ADD COLUMN note TEXT NOT NULL DEFAULT '';
   ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX idx_users_plan ON users(plan);
   CREATE INDEX idx_subs_user ON subscriptions(user_id, status);
   CREATE INDEX idx_orders_created ON orders(created_at);
   CREATE INDEX idx_jobs_created ON generation_jobs(created_at);`,
  // v8 — журнал действий администраторов
  `CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    actor_email TEXT NOT NULL DEFAULT '',
    actor_role TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    meta TEXT NOT NULL DEFAULT '{}',
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_audit_created ON audit_log(created_at);
  CREATE INDEX idx_audit_actor ON audit_log(actor_id);
  CREATE INDEX idx_audit_action ON audit_log(action);`,
  // v9 — сессии с IP/UA и двухфакторная аутентификация
  `ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT '';
   ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
   ALTER TABLE users ADD COLUMN totp_secret TEXT;
   ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN totp_backup TEXT NOT NULL DEFAULT '[]';`,
  // v10 — промокоды и скидки в заказах
  `CREATE TABLE promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'percent',
    value REAL NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT,
    expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE promo_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_id INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (promo_id, order_id)
  );
  ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN promo_code TEXT;`,
  // v11 — рассылки по email
  `CREATE TABLE email_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE TABLE email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE CASCADE,
    user_id INTEGER,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
  );
  CREATE INDEX idx_outbox_status ON email_outbox(status);`,
  // v12 — отписка от рассылок
  `ALTER TABLE users ADD COLUMN email_opt_out INTEGER NOT NULL DEFAULT 0;`,
  // v13 — сброс пароля по коду из email
  `CREATE TABLE password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at TEXT,
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at);`,
  // v14 — сессии, защита от перебора и постоянный rate-limit
  `ALTER TABLE sessions ADD COLUMN last_used_at TEXT;
   CREATE TABLE login_attempts (
     email TEXT PRIMARY KEY,
     fails INTEGER NOT NULL DEFAULT 0,
     window_start TEXT NOT NULL DEFAULT (datetime('now')),
     locked_until TEXT,
     last_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE rate_limits (
     key TEXT PRIMARY KEY,
     window_start INTEGER NOT NULL,
     count INTEGER NOT NULL
   );
   CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);`,
  // v15 — история работ и архивы результатов
  `ALTER TABLE generation_jobs ADD COLUMN artifact_key TEXT;
   ALTER TABLE generation_jobs ADD COLUMN artifact_size INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE generation_jobs ADD COLUMN artifact_sha TEXT;
   ALTER TABLE generation_jobs ADD COLUMN archived_at TEXT;
   ALTER TABLE generation_jobs ADD COLUMN expires_at TEXT;
   CREATE INDEX idx_jobs_expires ON generation_jobs(expires_at);
   CREATE TABLE activity_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'ok',
     total INTEGER NOT NULL DEFAULT 0,
     ok_count INTEGER NOT NULL DEFAULT 0,
     fail_count INTEGER NOT NULL DEFAULT 0,
     meta TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT
   );
   CREATE INDEX idx_activity_user ON activity_log(user_id, created_at);
   UPDATE generation_jobs SET expires_at = datetime('now', '+30 days') WHERE expires_at IS NULL;`,
  // v16 — S3-хранилище архивов и платный архивный пакет
  `ALTER TABLE generation_jobs ADD COLUMN artifact_backend TEXT NOT NULL DEFAULT 'local';
   ALTER TABLE users ADD COLUMN archive_until TEXT;
   ALTER TABLE users ADD COLUMN archive_mb INTEGER NOT NULL DEFAULT 0;`,
  // v17 — шаблоны наборов (КИН + состав)
  `CREATE TABLE set_templates (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL DEFAULT '',
     set_gtin TEXT NOT NULL DEFAULT '',
     format TEXT NOT NULL DEFAULT '58x80',
     components TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_set_templates_user ON set_templates(user_id);`,
  // v18 — рекламные кампании и статистика
  `CREATE TABLE ad_campaigns (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     advertiser TEXT NOT NULL DEFAULT '',
     title TEXT NOT NULL DEFAULT '',
     text TEXT NOT NULL DEFAULT '',
     image_key TEXT,
     target_url TEXT NOT NULL DEFAULT '',
     placement TEXT NOT NULL DEFAULT 'landing_banner',
     status TEXT NOT NULL DEFAULT 'draft',
     price REAL NOT NULL DEFAULT 0,
     paid INTEGER NOT NULL DEFAULT 0,
     paid_at TEXT,
     starts_at TEXT,
     ends_at TEXT,
     impression_limit INTEGER NOT NULL DEFAULT 0,
     click_limit INTEGER NOT NULL DEFAULT 0,
     impressions INTEGER NOT NULL DEFAULT 0,
     clicks INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_ads_slot ON ad_campaigns(placement, status, paid);
   CREATE TABLE ad_daily_stats (
     ad_id INTEGER NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     impressions INTEGER NOT NULL DEFAULT 0,
     clicks INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (ad_id, day)
   );`,
  // v19 — публичный идентификатор сессии вместо выдачи raw-токена в админке
  `ALTER TABLE sessions ADD COLUMN public_id TEXT;
   UPDATE sessions SET public_id = lower(hex(randomblob(16))) WHERE public_id IS NULL;
   CREATE UNIQUE INDEX idx_sessions_public_id ON sessions(public_id);`,
  // v20 — одноразовые ссылки входа: админ быстро помогает клиенту, который не может войти
  `CREATE TABLE login_links (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash TEXT NOT NULL UNIQUE,
     expires_at TEXT NOT NULL,
     used_at TEXT,
     created_by INTEGER,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_login_links_user ON login_links(user_id, created_at);`,
  // v21 — журнал приложения: серверные и клиентские ошибки для диагностики
  `CREATE TABLE app_logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     level TEXT NOT NULL DEFAULT 'error',
     source TEXT NOT NULL DEFAULT 'server',
     event TEXT NOT NULL DEFAULT '',
     message TEXT NOT NULL DEFAULT '',
     stack TEXT NOT NULL DEFAULT '',
     method TEXT NOT NULL DEFAULT '',
     url TEXT NOT NULL DEFAULT '',
     status INTEGER NOT NULL DEFAULT 0,
     user_id INTEGER,
     ip TEXT NOT NULL DEFAULT '',
     request_id TEXT NOT NULL DEFAULT '',
     meta TEXT NOT NULL DEFAULT '{}',
     user_agent TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_app_logs_created ON app_logs(created_at);
   CREATE INDEX idx_app_logs_level ON app_logs(level, created_at);
   CREATE INDEX idx_app_logs_source ON app_logs(source, created_at);`,
  // v22 — история входов, просмотр «как клиент» и белый список IP
  `CREATE TABLE login_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER,
     email TEXT NOT NULL DEFAULT '',
     ok INTEGER NOT NULL DEFAULT 1,
     reason TEXT NOT NULL DEFAULT '',
     ip TEXT NOT NULL DEFAULT '',
     user_agent TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_login_events_user ON login_events(user_id, created_at);
   CREATE INDEX idx_login_events_created ON login_events(created_at);

   CREATE TABLE view_sessions (
     token TEXT PRIMARY KEY,
     admin_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     expires_at TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_view_sessions_expires ON view_sessions(expires_at);

   CREATE TABLE ip_allowlist (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ip TEXT NOT NULL UNIQUE,
     note TEXT NOT NULL DEFAULT '',
     created_by INTEGER,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  // v23 — напоминание об окончании PREMIUM (чтобы не отправлять письмо каждый день)
  `ALTER TABLE users ADD COLUMN premium_notice_at TEXT;`,
  // v24 — журнал запросов к AI-помощнику в админке
  `CREATE TABLE ai_queries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER,
     admin_id INTEGER,
     question TEXT NOT NULL DEFAULT '',
     answer TEXT NOT NULL DEFAULT '',
     actions TEXT NOT NULL DEFAULT '[]',
     model TEXT NOT NULL DEFAULT '',
     backend TEXT NOT NULL DEFAULT 'api',
     status TEXT NOT NULL DEFAULT 'ok',
     error TEXT NOT NULL DEFAULT '',
     duration_ms INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_ai_queries_user ON ai_queries(user_id, created_at);`,
  // v25 — учёт токенов и провайдера (бесплатная модель / аккаунт)
  `ALTER TABLE ai_queries ADD COLUMN prompt_tokens INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE ai_queries ADD COLUMN completion_tokens INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE ai_queries ADD COLUMN via TEXT NOT NULL DEFAULT '';
   CREATE INDEX idx_ai_queries_created ON ai_queries(created_at);`,
  // v26 — база знаний и обращения клиентов в поддержку
  `CREATE TABLE kb_articles (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     slug TEXT NOT NULL UNIQUE,
     title TEXT NOT NULL,
     summary TEXT NOT NULL DEFAULT '',
     body TEXT NOT NULL DEFAULT '',
     tags TEXT NOT NULL DEFAULT '',
     published INTEGER NOT NULL DEFAULT 1,
     calls INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE support_tickets (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     subject TEXT NOT NULL DEFAULT '',
     message TEXT NOT NULL DEFAULT '',
     ai_context TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'open',
     admin_note TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_support_tickets_user ON support_tickets(user_id, created_at);
   CREATE INDEX idx_support_tickets_status ON support_tickets(status, created_at);`,
  // v27 — кэш карточек товара по GTIN (данные из открытых источников и своей базы)
  `CREATE TABLE product_cards (
     gtin TEXT PRIMARY KEY,
     name TEXT NOT NULL DEFAULT '',
     brand TEXT NOT NULL DEFAULT '',
     category TEXT NOT NULL DEFAULT '',
     quantity TEXT NOT NULL DEFAULT '',
     producer TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT '',
     raw TEXT NOT NULL DEFAULT '{}',
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  // v28 — личный токен «Честного ЗНАКа» (True API) у клиента
  `ALTER TABLE users ADD COLUMN cz_token TEXT NOT NULL DEFAULT '';`
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
