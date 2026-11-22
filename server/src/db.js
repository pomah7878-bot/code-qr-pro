import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, '..', 'data', 'app.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
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
  `ALTER TABLE users ADD COLUMN cz_token TEXT NOT NULL DEFAULT '';`,
  // v29 — тарифы в БД: 4 тарифа, цены месяц/год, лимиты операций и проверок
  `CREATE TABLE plans (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     price_monthly REAL NOT NULL DEFAULT 0,
     price_yearly REAL NOT NULL DEFAULT 0,
     ops_per_period INTEGER NOT NULL DEFAULT 0,
     daily_ops INTEGER NOT NULL DEFAULT 0,
     checks_per_period INTEGER NOT NULL DEFAULT 0,
     batch_max INTEGER NOT NULL DEFAULT 100,
     formats TEXT NOT NULL DEFAULT '["png","svg"]',
     history_days INTEGER NOT NULL DEFAULT 7,
     archive_mb INTEGER NOT NULL DEFAULT 50,
     features TEXT NOT NULL DEFAULT '{}',
     sort_order INTEGER NOT NULL DEFAULT 0,
     recommended INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   INSERT OR IGNORE INTO plans
     (id, title, description, price_monthly, price_yearly, ops_per_period, daily_ops,
      checks_per_period, batch_max, formats, history_days, archive_mb, features, sort_order, recommended, active)
   VALUES
     ('free', 'FREE', 'Для знакомства с сервисом и небольших объёмов', 0, 0, 600, 20, 0, 20,
      '["png","svg","pdf"]', 7, 50,
      '{"labelEditor":false,"printBridge":false,"apiAccess":false,"aiAssistant":true,"templates":false,"employees":1,"extendedChecks":false}', 1, 0, 1),
     ('start', 'START', 'Для небольшого бизнеса: расширенные форматы и массовая обработка', 149, 1490, 500, 0, 0, 5000,
      '["png","svg","pdf"]', 7, 500,
      '{"labelEditor":false,"printBridge":false,"apiAccess":false,"aiAssistant":true,"templates":false,"employees":1,"extendedChecks":false}', 2, 0, 1),
     ('pro', 'PRO', 'Оптимальный тариф: сохранение шаблонов, AI-помощник и расширенные проверки', 349, 3490, 5000, 0, 500, 5000,
      '["png","svg","pdf","zip"]', 30, 2048,
      '{"labelEditor":true,"printBridge":true,"apiAccess":true,"aiAssistant":true,"templates":true,"employees":1,"extendedChecks":true}', 3, 1, 1),
     ('business', 'BUSINESS', 'Для больших объёмов: 30 000 операций и 5 сотрудников', 799, 7990, 30000, 0, 3000, 5000,
      '["png","svg","pdf","zip"]', 1095, 10240,
      '{"labelEditor":true,"printBridge":true,"apiAccess":true,"aiAssistant":true,"templates":true,"employees":5,"extendedChecks":true}', 4, 0, 1);`,
  // v30 — пробный период PRO 7 дней; старые premium/test переводим в PRO
  `ALTER TABLE users ADD COLUMN trial_started_at TEXT;
   ALTER TABLE users ADD COLUMN trial_ends_at TEXT;
   ALTER TABLE users ADD COLUMN trial_used INTEGER NOT NULL DEFAULT 0;
   UPDATE users SET plan='pro' WHERE plan IN ('premium','test');
   UPDATE subscriptions SET plan='pro' WHERE plan IN ('premium','test');
   CREATE INDEX idx_users_trial ON users(trial_ends_at);`,
  // v31 — учёт использования по периодам, идемпотентные события, расширенный кэш карточек
  `CREATE TABLE usage_periods (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     plan TEXT NOT NULL DEFAULT 'free',
     source TEXT NOT NULL DEFAULT 'free',
     period_start TEXT NOT NULL,
     period_end TEXT,
     ops_used INTEGER NOT NULL DEFAULT 0,
     checks_used INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(user_id, period_start)
   );
   CREATE INDEX idx_usage_periods_user ON usage_periods(user_id, period_start DESC);
   CREATE TABLE usage_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     period_id INTEGER,
     kind TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 1,
     context TEXT NOT NULL DEFAULT '',
     idem_key TEXT,
     external INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'ok',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_usage_events_user ON usage_events(user_id, created_at DESC);
   CREATE UNIQUE INDEX idx_usage_events_idem ON usage_events(user_id, idem_key) WHERE idem_key IS NOT NULL;
   ALTER TABLE usage_daily ADD COLUMN ops_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE usage_daily ADD COLUMN checks_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE product_cards ADD COLUMN product_kind TEXT NOT NULL DEFAULT '';
   ALTER TABLE product_cards ADD COLUMN volume TEXT NOT NULL DEFAULT '';
   ALTER TABLE product_cards ADD COLUMN composition TEXT NOT NULL DEFAULT '';
   ALTER TABLE product_cards ADD COLUMN country TEXT NOT NULL DEFAULT '';
   ALTER TABLE product_cards ADD COLUMN production_date TEXT NOT NULL DEFAULT '';
   ALTER TABLE product_cards ADD COLUMN expiration_date TEXT NOT NULL DEFAULT '';
   ALTER TABLE product_cards ADD COLUMN crypto TEXT NOT NULL DEFAULT '';
   ALTER TABLE product_cards ADD COLUMN source_label TEXT NOT NULL DEFAULT '';
   ALTER TABLE product_cards ADD COLUMN fetched_at TEXT;
   ALTER TABLE product_cards ADD COLUMN expires_at TEXT;
   CREATE TABLE external_requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER,
     adapter TEXT NOT NULL,
     ok INTEGER NOT NULL DEFAULT 0,
     status_code INTEGER NOT NULL DEFAULT 0,
     latency_ms INTEGER NOT NULL DEFAULT 0,
     error TEXT NOT NULL DEFAULT '',
     cost_units INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_external_requests_created ON external_requests(created_at);
   CREATE TABLE payment_events (
     external_id TEXT PRIMARY KEY,
     provider TEXT NOT NULL DEFAULT 'yookassa',
     order_id INTEGER,
     status TEXT NOT NULL DEFAULT '',
     payload_hash TEXT NOT NULL DEFAULT '',
     processed_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  // v32 — подписки/заказы: период оплаты, автопродление, тип
  `ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'subscription';
   ALTER TABLE orders ADD COLUMN period TEXT NOT NULL DEFAULT 'month';
   ALTER TABLE orders ADD COLUMN plan_title TEXT NOT NULL DEFAULT '';
   ALTER TABLE subscriptions ADD COLUMN source TEXT NOT NULL DEFAULT 'payment';
   ALTER TABLE subscriptions ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subscriptions ADD COLUMN canceled_at TEXT;
   ALTER TABLE subscriptions ADD COLUMN plan_title TEXT NOT NULL DEFAULT '';`,
  // v33 — настройки новых модулей
  `INSERT OR IGNORE INTO app_settings (key, value) VALUES
     ('trial_days', '7'),
     ('trial_checks', '50'),
     ('cache_card_ttl_seconds', '86400'),
     ('cache_error_ttl_seconds', '60'),
     ('extended_checks_enabled', '1'),
     ('auto_trial', '0'),
     ('pricing_link_promo', '');`,
  // v34 — отметка отправленного напоминания об окончании триала
  `ALTER TABLE users ADD COLUMN trial_notice_at TEXT;
   INSERT OR IGNORE INTO app_settings (key, value) VALUES ('trial_notice_days', '2');`,
  // v35 — идемпотентность генерации: повторный запрос с тем же ключом не создаёт дубль задания
  `ALTER TABLE generation_jobs ADD COLUMN idem_key TEXT;
   CREATE UNIQUE INDEX idx_jobs_idem ON generation_jobs(user_id, idem_key) WHERE idem_key IS NOT NULL;`,
  // v36 — согласие на обработку персональных данных и принятие документов при регистрации
  `ALTER TABLE users ADD COLUMN consent_at TEXT;
   ALTER TABLE users ADD COLUMN consent_version TEXT;`,
  // v38 — зарезервировано (миграция B2B перенесена в v39, чтобы не нарушать порядок версий)
  `SELECT 1;`,
  // v37 — первичная веб-аналитика: просмотры публичных страниц, боты, поисковые запросы, конверсии
  `CREATE TABLE IF NOT EXISTS site_visits (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     day TEXT NOT NULL,
     path TEXT NOT NULL DEFAULT '/',
     referrer TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'direct',
     medium TEXT NOT NULL DEFAULT '',
     campaign TEXT NOT NULL DEFAULT '',
     query TEXT NOT NULL DEFAULT '',
     device TEXT NOT NULL DEFAULT 'desktop',
     engine TEXT NOT NULL DEFAULT '',
     is_bot INTEGER NOT NULL DEFAULT 0,
     session_id TEXT NOT NULL DEFAULT '',
     visitor_id TEXT NOT NULL DEFAULT '',
     user_id INTEGER,
     status INTEGER NOT NULL DEFAULT 200,
     origin TEXT NOT NULL DEFAULT 'live'
   );
   CREATE INDEX IF NOT EXISTS idx_site_visits_day ON site_visits(day);
   CREATE INDEX IF NOT EXISTS idx_site_visits_source ON site_visits(day, source);
   CREATE INDEX IF NOT EXISTS idx_site_visits_bot ON site_visits(day, is_bot, engine);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_site_visits_unique ON site_visits(day, session_id, path) WHERE is_bot = 0 AND session_id <> '';
   CREATE TABLE IF NOT EXISTS seo_queries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     engine TEXT NOT NULL DEFAULT 'yandex',
     query TEXT NOT NULL,
     clicks INTEGER NOT NULL DEFAULT 0,
     impressions INTEGER NOT NULL DEFAULT 0,
     position REAL NOT NULL DEFAULT 0,
     date_from TEXT NOT NULL DEFAULT '',
     date_to TEXT NOT NULL DEFAULT '',
     imported_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(engine, query, date_from, date_to)
   );
   CREATE INDEX IF NOT EXISTS idx_seo_queries_to ON seo_queries(date_to);
   CREATE TABLE IF NOT EXISTS site_conversions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     day TEXT NOT NULL,
     type TEXT NOT NULL,
     user_id INTEGER,
     amount REAL NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS idx_site_conversions_day ON site_conversions(day, type);`,
  // v39 — B2B-покупка: реквизиты покупателя-юрлица и счёт на оплату
  `ALTER TABLE orders ADD COLUMN buyer_type TEXT NOT NULL DEFAULT 'individual';
   ALTER TABLE orders ADD COLUMN company_name TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN company_inn TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN company_kpp TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN company_address TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN company_email TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN invoice_number TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN invoice_issued_at TEXT;
   ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'card';`,
  // v40 — чеки НПД («Мой налог»): id, ссылка, статус и отправка на email
  `ALTER TABLE orders ADD COLUMN npd_receipt_id TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN npd_receipt_url TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN npd_receipt_status TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN npd_receipt_error TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN npd_receipt_email TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN npd_receipt_at TEXT;`,
  // v41 — first-touch атрибуция регистраций по UTM/referrer
  `ALTER TABLE users ADD COLUMN acq_source TEXT NOT NULL DEFAULT '';
   ALTER TABLE users ADD COLUMN acq_medium TEXT NOT NULL DEFAULT '';
   ALTER TABLE users ADD COLUMN acq_campaign TEXT NOT NULL DEFAULT '';
   ALTER TABLE users ADD COLUMN acq_landing TEXT NOT NULL DEFAULT '';`,
  // v42 — онлайн-оплата B2B-счёта через выставленный счёт ЮKassa
  `ALTER TABLE orders ADD COLUMN yk_invoice_id TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN yk_invoice_url TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN yk_invoice_status TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN yk_invoice_error TEXT NOT NULL DEFAULT '';
   ALTER TABLE orders ADD COLUMN yk_invoice_expires_at TEXT;
   ALTER TABLE orders ADD COLUMN yk_invoice_created_at TEXT;`,
  // v43 — сверка банковской выписки с B2B-счетами
  `CREATE TABLE IF NOT EXISTS bank_transactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tx_hash TEXT NOT NULL UNIQUE,
     tx_date TEXT NOT NULL DEFAULT '',
     amount REAL NOT NULL DEFAULT 0,
     payer TEXT NOT NULL DEFAULT '',
     payer_inn TEXT NOT NULL DEFAULT '',
     purpose TEXT NOT NULL DEFAULT '',
     raw_json TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'unmatched',
     order_id INTEGER,
     error TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     matched_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_bank_tx_status ON bank_transactions(status, created_at);
   CREATE INDEX IF NOT EXISTS idx_bank_tx_amount ON bank_transactions(amount);`,
  // v44 — раздельные лимиты: генерация, проверки, экспорт, API; новые тарифы
  `ALTER TABLE plans ADD COLUMN exports_per_period INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE plans ADD COLUMN api_calls_per_period INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE usage_periods ADD COLUMN exports_used INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE usage_periods ADD COLUMN api_calls_used INTEGER NOT NULL DEFAULT 0;

  UPDATE plans SET title='FREE', description='Для знакомства с сервисом и небольших объёмов',
    price_monthly=0, price_yearly=0, ops_per_period=600, daily_ops=20, checks_per_period=0,
    exports_per_period=20, api_calls_per_period=0, batch_max=20, history_days=7, archive_mb=50,
    formats='["png","svg","pdf"]', features='{"labelEditor":false,"printBridge":false,"apiAccess":false,"aiAssistant":true,"templates":false,"employees":1,"extendedChecks":false}',
    sort_order=1, recommended=0, active=1, updated_at=datetime('now') WHERE id='free';

  UPDATE plans SET title='START', active=0, recommended=0, sort_order=90, exports_per_period=200, api_calls_per_period=0, updated_at=datetime('now') WHERE id='start';

  UPDATE plans SET title='PRO', description='Для небольших производств, складов и селлеров',
    price_monthly=590, price_yearly=5900, ops_per_period=20000, daily_ops=0, checks_per_period=2000,
    exports_per_period=1000, api_calls_per_period=20000, batch_max=10000, history_days=365, archive_mb=2048,
    formats='["png","svg","pdf","zip"]', features='{"labelEditor":true,"printBridge":true,"apiAccess":true,"aiAssistant":true,"templates":true,"employees":3,"extendedChecks":true}',
    sort_order=3, recommended=0, active=1, updated_at=datetime('now') WHERE id='pro';

  UPDATE plans SET title='BUSINESS', description='Для растущих производств и маркетплейсов — рекомендуем',
    price_monthly=1490, price_yearly=14900, ops_per_period=100000, daily_ops=0, checks_per_period=10000,
    exports_per_period=5000, api_calls_per_period=100000, batch_max=50000, history_days=1095, archive_mb=10240,
    formats='["png","svg","pdf","zip"]', features='{"labelEditor":true,"printBridge":true,"apiAccess":true,"aiAssistant":true,"templates":true,"employees":10,"extendedChecks":true}',
    sort_order=4, recommended=1, active=1, updated_at=datetime('now') WHERE id='business';

  INSERT INTO plans (id,title,description,price_monthly,price_yearly,ops_per_period,daily_ops,checks_per_period,
    exports_per_period,api_calls_per_period,batch_max,formats,history_days,archive_mb,features,sort_order,recommended,active,updated_at)
  VALUES ('enterprise','ENTERPRISE','Для больших объёмов, нескольких юрлиц и интеграций',
    3990,39900,500000,0,50000,50000,1000000,100000,
    '["png","svg","pdf","zip"]',3650,30720,
    '{"labelEditor":true,"printBridge":true,"apiAccess":true,"aiAssistant":true,"templates":true,"employees":50,"extendedChecks":true}',
    5,0,1,datetime('now'))
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,
    price_monthly=excluded.price_monthly,price_yearly=excluded.price_yearly,ops_per_period=excluded.ops_per_period,
    daily_ops=excluded.daily_ops,checks_per_period=excluded.checks_per_period,exports_per_period=excluded.exports_per_period,
    api_calls_per_period=excluded.api_calls_per_period,batch_max=excluded.batch_max,formats=excluded.formats,
    history_days=excluded.history_days,archive_mb=excluded.archive_mb,features=excluded.features,
    sort_order=excluded.sort_order,recommended=excluded.recommended,active=excluded.active,updated_at=datetime('now');

  UPDATE plans SET recommended=0;
  UPDATE plans SET recommended=1 WHERE id='business';
  DELETE FROM app_settings WHERE key='premium_offers';
  INSERT INTO app_settings (key,value) VALUES ('trial_days','7') ON CONFLICT(key) DO UPDATE SET value='7';`,
  // v45 — сохранить экспортный лимит для legacy-тарифа START
  `UPDATE plans SET exports_per_period=200 WHERE id='start' AND exports_per_period=0;`,
  // v46 — командный доступ: приглашённые сотрудники с сессией владельца
  `CREATE TABLE IF NOT EXISTS team_members (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     email TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     role TEXT NOT NULL DEFAULT 'operator',
     token_hash TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'invited',
     expires_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     last_login_at TEXT,
     revoked_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_team_owner ON team_members(owner_id, status);
   ALTER TABLE sessions ADD COLUMN team_member_id INTEGER;`,
  // v47 — личные аккаунты сотрудников
  `ALTER TABLE team_members ADD COLUMN user_id INTEGER;
   ALTER TABLE users ADD COLUMN owner_id INTEGER;
   ALTER TABLE users ADD COLUMN member_role TEXT NOT NULL DEFAULT '';`,
  // v48 — авторство заданий и активность команды
  `ALTER TABLE generation_jobs ADD COLUMN created_by_member_id INTEGER;
   ALTER TABLE generation_jobs ADD COLUMN created_by_name TEXT NOT NULL DEFAULT '';
   ALTER TABLE generation_jobs ADD COLUMN created_by_email TEXT NOT NULL DEFAULT '';
   ALTER TABLE activity_log ADD COLUMN member_id INTEGER;
   ALTER TABLE activity_log ADD COLUMN member_name TEXT NOT NULL DEFAULT '';
   ALTER TABLE activity_log ADD COLUMN member_email TEXT NOT NULL DEFAULT '';`,
  // v49 — комментарии и корзина заданий
  `ALTER TABLE generation_jobs ADD COLUMN deleted_at TEXT;
   ALTER TABLE generation_jobs ADD COLUMN deleted_by_member_id INTEGER;
   ALTER TABLE generation_jobs ADD COLUMN deleted_by_name TEXT NOT NULL DEFAULT '';
   CREATE TABLE IF NOT EXISTS job_comments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL,
     member_id INTEGER,
     author_name TEXT NOT NULL DEFAULT '',
     author_email TEXT NOT NULL DEFAULT '',
     text TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS idx_job_comments_job ON job_comments(job_id, id);`,
  // v50 — ответственный и рабочий статус задания
  `ALTER TABLE generation_jobs ADD COLUMN assigned_to_member_id INTEGER;
   ALTER TABLE generation_jobs ADD COLUMN assigned_to_name TEXT NOT NULL DEFAULT '';
   ALTER TABLE generation_jobs ADD COLUMN work_status TEXT NOT NULL DEFAULT 'new';`
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
