# Расширение админ-панели CODE QR PRO — план

**Дата:** 18.11.2026
**Статус:** на согласование
**Ветка:** `admin-expansion` (от `master`)
**Стек без изменений:** Node 20 / Fastify / better-sqlite3 / Vue 3 / Vite / Tailwind.

## 1. Цель

Превратить админку из витрины цифр в рабочий инструмент: ежедневные операции с клиентами и платежами, аналитика, контроль безопасности, монетизация. Не ломая существующие публичные API, вход и деплой.

Сейчас: `web/src/pages/Admin.vue` (184 строки, один экран) + `server/src/routes-admin.js` (109 строк, 8 эндпоинтов). После: 9 экранов, ~40 эндпоинтов, 5 миграций SQLite, ~3 000 строк кода.

## 2. Что есть сейчас

| Блок | Возможности | Ограничение |
|---|---|---|
| Сводка | пользователи, PREMIUM, пакеты, коды за день, выручка за всё время, ожидающие оплаты | нет динамики и конверсии |
| Клиенты | последние 200, переключение FREE/PREMIUM | нет поиска, карточки, блокировки, сроков |
| Платежи | список последних 100, только чтение | нельзя подтвердить, отменить, вернуть |
| Тарифы | периоды PREMIUM + скидка | лимиты тарифов зашиты в `plans.js` |
| Отзывы | модерация | — |
| Честный ЗНАК | URL + токен | нет проверки подключения |
| Задания | нет | видны только пользователю |

## 3. Новая структура

`/app/admin` → layout с подменю, вложенные маршруты:

```
/app/admin                 Обзор
/app/admin/users           Клиенты
/app/admin/users/:id       Карточка клиента
/app/admin/orders          Платежи
/app/admin/jobs            Задания
/app/admin/marketing       Промокоды · Рассылки · Отзывы
/app/admin/audit           Журнал действий
/app/admin/settings        Тарифы и лимиты · ЧЗ · SMTP · 2FA
```

Файлы фронтенда: `web/src/pages/admin/AdminLayout.vue` + 8 экранов, общие компоненты `web/src/components/admin/` (StatCard, LineChart на SVG, DataTable, Pagination, Modal, ConfirmDialog, Toast, StatusBadge). Старый `Admin.vue` заменяется, маршрут `/app/admin` продолжает работать.

Бэкенд: `routes-admin.js` разбивается на `routes-admin-{users,orders,promo,email,audit,health}.js`, общие проверки — `lib/require-admin.js`, аудит — `lib/audit.js`.

## 4. Миграции

Продолжаем `MIGRATIONS` в `server/src/db.js` (версия 6 → 11). Все `ALTER TABLE ADD COLUMN` в SQLite дешёвые, таблицы маленькие.

### v7 — клиенты и операции

```sql
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';       -- active | blocked
ALTER TABLE users ADD COLUMN blocked_at TEXT;
ALTER TABLE users ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_opt_out INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_users_plan ON users(plan);
CREATE INDEX idx_subs_user ON subscriptions(user_id, status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_jobs_created ON generation_jobs(created_at);
```

Блокировка действует сразу: `sessionUser()` начинает возвращать `status`, `requireAuth` отвечает 403, вход и API-ключи блокируются.

### v8 — аудит

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_email TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,                -- user.grant, order.confirm, settings.smtp ...
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',     -- JSON: было/стало, причина
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_action ON audit_log(action);
```

Пишется из всех изменяющих админ-эндпоинтов через `audit(req, action, target, meta)`. Ошибка записи не роняет основной запрос. Хранение 365 дней, ночная чистка.

### v9 — промокоды

```sql
CREATE TABLE promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'percent',   -- percent | fixed | days
  value REAL NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 0,    -- 0 = без лимита
  used_count INTEGER NOT NULL DEFAULT 0,
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT, expires_at TEXT,
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
ALTER TABLE orders ADD COLUMN promo_code TEXT;
```

### v10 — сессии и 2FA

```sql
ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_backup TEXT NOT NULL DEFAULT '[]';   -- sha256 резервных кодов
```

### v11 — рассылки

```sql
CREATE TABLE email_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sending | done | canceled
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
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | failed
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX idx_outbox_status ON email_outbox(status);
```

## 5. Роли и доступ

Две роли: `admin` (всё) и `support` (клиенты, задания, отзывы — без денег, настроек, рассылок и промокодов). Проверки: `requireAdmin` (как сейчас) и новый `requireStaff` (admin или support); чувствительные эндпоинты остаются только на `requireAdmin`.

| Раздел | admin | support |
|---|---|---|
| Обзор, клиенты, карточка, задания | да | да |
| Выдача/снятие PREMIUM, блокировка, удаление | да | нет |
| Платежи, возвраты, промокоды, рассылки | да | нет |
| Настройки, аудит, 2FA | да | нет |
| Отзывы | да | да |

## 6. API

### Общее и аналитика (B)
- `GET /api/admin/overview?days=30` — выручка сегодня/7/30, MRR, ARPU, новые клиенты, конверсия, активные подписки, истекают за 7 дней, очередь и ошибки заданий.
- `GET /api/admin/series?metric=revenue|signups|codes|conversion&days=30` — точки для графика.
- `GET /api/admin/health` — uptime, RSS, размер БД и папки `jobs`, очередь, ошибки за 24 ч, свободное место, готовность ЮKassa/Telegram/SMTP/ЧЗ.
- `GET /api/admin/audit?page&action&actor&from&to`.
- `GET/PUT /api/admin/plans` — лимиты FREE/PREMIUM (коды/день, пакет, форматы, API, этикетки, история).
- `GET/PUT /api/admin/settings/cz`, `GET/PUT /api/admin/settings/smtp`, `POST /api/admin/settings/smtp/test`.

### Клиенты (A)
- `GET /api/admin/users?q&plan&role&status&page&per` — поиск по email/имени/id, пагинация.
- `GET /api/admin/users/export.csv`.
- `GET /api/admin/users/:id` — профиль, подписки, платежи, задания, ключи, сессии, отзыв.
- `POST /api/admin/users/:id/grant {days}` — выдать/продлить на 1–3650 дней.
- `POST /api/admin/users/:id/revoke`.
- `POST /api/admin/users/:id/block {reason}` / `unblock`.
- `POST /api/admin/users/:id/password-reset` — временный пароль, показывается один раз, флаг `must_change_password`.
- `POST /api/admin/users/:id/role {role}`.
- `POST /api/admin/users/:id/note {note}`.
- `DELETE /api/admin/users/:id` — полное удаление с каскадом, подтверждение вводом email.
- `DELETE /api/admin/users/:id/sessions`, `DELETE /api/admin/sessions/:token`.

### Платежи (A)
- `GET /api/admin/orders?status&q&from&to&page`, `GET /api/admin/orders/export.csv`.
- `POST /api/admin/orders/:id/confirm` — ручное подтверждение: `activatePremium(..., order.days)`, аудит, уведомление.
- `POST /api/admin/orders/:id/cancel` — отмена (для pending; у ЮKassa — best-effort `cancel`).
- `POST /api/admin/orders/:id/refund {revoke}` — возврат через ЮKassa, статус `refunded`, опционально снять PREMIUM.
- `POST /api/admin/orders/:id/recheck` — повторная проверка статуса.

### Задания (B)
- `GET /api/admin/jobs?status&q&page`, `GET /api/admin/jobs/:id`.
- `POST /api/admin/jobs/:id/retry`, `DELETE /api/admin/jobs/:id` — с удалением файлов.

### Промокоды (D)
- `GET/POST /api/admin/promo`, `PUT/DELETE /api/admin/promo/:id`, `GET /api/admin/promo/:id/redemptions`.
- `POST /api/billing/promo/check` — публичная проверка кода и итоговой цены перед оплатой.
- `POST /api/billing/checkout` принимает `promoCode`.

### Рассылки (D)
- `GET /api/admin/email/campaigns`, `GET /api/admin/email/campaigns/:id`, `GET /api/admin/email/outbox`.
- `POST /api/admin/email/preview {segment,subject,body}` — сколько получателей и как выглядит письмо.
- `POST /api/admin/email/send {segment,subject,body}` — создаёт кампанию и очередь.
- `GET /api/email/unsubscribe?t=...` — отписка по HMAC-ссылке.

### 2FA (C)
- `POST /api/auth/2fa/setup` — секрет + `otpauth://` + QR (рендерим `bwip-js` с `bcid: 'qrcode'`, без новой зависимости).
- `POST /api/auth/2fa/enable {code}`, `POST /api/auth/2fa/disable {password, code}`.
- `POST /api/auth/login` при включённой 2FA возвращает `{ twoFactor: true, ticket }` (HMAC, 5 минут, 5 попыток).
- `POST /api/auth/2fa {ticket, code}` — вход по коду или резервному коду.
- `POST /api/auth/password` — смена своего пароля (в т.ч. после сброса администратором).

## 7. Экраны

**Обзор.** Шесть KPI с дельтой к прошлому периоду, график (выручка / регистрации / коды, 30 или 90 дней), блок «Требует внимания» (ошибки заданий, истекающие подписки, неоплаченные заказы, ошибки SMTP), последние платежи и регистрации, краткое здоровье сервиса.

**Клиенты.** Поиск с задержкой 300 мс, фильтры (тариф, роль, статус, дата регистрации), таблица с пагинацией, экспорт CSV.

**Карточка клиента.** Шапка: email, имя, тариф, срок, статус, заметка. Действия: выдать/продлить на N дней, снять, заблокировать с причиной, сбросить пароль, сменить роль, удалить (ввод email), выйти со всех устройств. Вкладки: подписки, платежи, задания, API-ключи, сессии, отзыв.

**Платежи.** Фильтры по статусу и датам, поиск по email/номеру, действия по строке, экспорт CSV, сводка сверху (оплачено за период, возвраты, ожидает).

**Задания.** Очередь и ошибки, фильтр по статусу, повтор и удаление, ссылка на файлы.

**Маркетинг.** Три вкладки: промокоды (таблица + форма), рассылки (сегмент, тема, текст, предпросмотр, отправка, история), отзывы (текущая модерация).

**Журнал.** Таблица аудита с фильтрами по действию, администратору и дате, JSON-детали в модалке, экспорт CSV.

**Настройки.** Тарифы и лимиты (FREE/PREMIUM: коды/день, размер пакета, форматы, API, этикетки, срок истории), Честный ЗНАК (+ кнопка проверки токена), SMTP (+ тестовое письмо), 2FA.

## 8. Правила промокодов

- `percent` — скидка 1–90 % от цены периода; `fixed` — минус ₽, но не ниже 1 ₽; `days` — бонусные дни к подписке без скидки.
- Условия: активен, окно `starts_at`–`expires_at`, `used_count < max_uses` (0 — без лимита), у клиента меньше `per_user_limit` погашений.
- Один код на заказ, не суммируется, только для `premium` и `test`.
- Скидка сохраняется в заказе (`discount`, `promo_code`), чек ЮKassa формируется на итоговую сумму.
- Погашение фиксируется только при успешной оплате (`UNIQUE(promo_id, order_id)` защищает от двойного списания), повторная проверка заказа идемпотентна.
- Отмена и возврат погашение не возвращают — так проще считать маркетинг; при необходимости добавим флаг.

## 9. Рассылки

- SMTP-настройки в `app_settings`, пароль пишется и никогда не отдаётся обратно (как токен ЧЗ).
- Зависимость `nodemailer` (единственная новая), отправка из очереди по 1 письму в секунду, 3 попытки, результат в `email_outbox`.
- Сегменты: все активные, FREE, PREMIUM, истёкшие, новые за 30 дней, спящие 90 дней. Учитывается `email_opt_out`.
- Письмо — текст + минимальный HTML-шаблон с шапкой бренда и ссылкой отписки (HMAC-токен).
- Перед отправкой — предпросмотр и точное число получателей; отправка только после подтверждения.
- Требуется настроить SPF/DKIM для домена — это операционная задача, не код.

## 10. 2FA и сессии

- TOTP (RFC 6238) реализуем на `node:crypto` + base32, без зависимостей.
- Включение: секрет + QR, подтверждение кодом, 10 резервных кодов (хранятся хешами, показываются один раз).
- Вход: пароль → тикет на 5 минут → код. Неверный код 5 раз — тикет сгорает, запись в аудит.
- Отключение — по паролю и действующему коду. Аварийный сброс — скрипт `scripts/reset-2fa.mjs` по email.
- Все сессии хранят IP, User-Agent и время последней активности; админ видит их в карточке клиента и может завершить любую.

## 11. Аудит

Пишем: вход/выход админа, неудачные попытки, выдачу и снятие PREMIUM, блокировку, смену роли, сброс пароля, удаление клиента, операции с заказами и возвратами, изменение настроек, тарифов, промокодов, отправку рассылок, включение 2FA. В `meta` — было/стало и причина. Просмотр — только admin. Ретенция 365 дней.

## 12. Платежи: ручные операции

- `confirm` разрешён только для `pending`; активирует PREMIUM на `order.days`, ставит `paid`, пишет аудит, шлёт уведомление.
- `cancel` — для `pending`; если есть `external_id`, сначала best-effort отмена в ЮKassa.
- `refund` — для `paid`; возврат через `POST /refunds` ЮKassa на полную сумму; статус `refunded`; чекбокс «снять доступ» (по умолчанию включён) обнуляет подписку.
- `recheck` — повторный `checkOrder` для зависших платежей; безопасен и идемпотентен.

## 13. Здоровье

`process.uptime()`, RSS, размер БД (`page_count * page_size`), размер `JOBS_DIR` (рекурсивно, кеш 60 с), число заданий `queued/running/error` за 24 ч, свободное место (`fs.statfs`), признаки настроек: ЮKassa, Telegram, SMTP, ЧЗ. Всё — только admin.

## 14. Безопасность и соответствие

- Блокировка мгновенная: проверка `status` в `sessionUser`, `login`, `requireApiKey`.
- Пароли — прежний scrypt; временный пароль генерируется `randomBytes`, живёт до смены.
- `must_change_password`: после сброса вход разрешён, но API отвечает 428 до смены пароля (кроме `/api/auth/password` и `/api/auth/logout`).
- CSRF: `SameSite=Lax` + проверка `Origin`/`Host` для изменяющих запросов из браузера.
- Удаление клиента — каскад из схемы (сессии, подписки, заказы, задания, ключи, отзывы), файлы заданий удаляются.
- 152-ФЗ: экспорт и удаление ПДн по клиенту, отписка от рассылок, ретенция аудита.
- Лимит запросов на админ-эндпоинты — отдельный, 120/мин на IP.

## 15. Тесты

Новые скрипты в `scripts/` по пакетам:
- `test-admin-a.mjs` — поиск, карточка, выдача на 90 дней, блокировка (старая сессия умирает), сброс пароля, ручное подтверждение и возврат заказа, CSV.
- `test-admin-b.mjs` — серии, конверсия, здоровье, повтор задания.
- `test-admin-c.mjs` — 2FA setup/enable/login/backup-код/disable, аудит, завершение сессии.
- `test-admin-d.mjs` — промокод percent/fixed/days, лимиты, checkout со скидкой, предпросмотр и отправка письма (SMTP в тесте — заглушка).

Плюс прогон существующих `test-stage2..5` на копии БД.

## 16. Порядок и оценка

| Этап | Состав | Оценка |
|---|---|---|
| A. Клиенты и платежи | миграция v7, 6 файлов бэкенда, 3 экрана, CSV, тест | 1 рабочий день |
| B. Аналитика и здоровье | overview/series/health, графики, 3 экрана, тест | 0,5–1 день |
| C. Безопасность | v8 + v10, аудит, роли, сессии, 2FA, 2 экрана, тест | 1–1,5 дня |
| D. Монетизация | v9 + v11, промокоды, лимиты тарифов, SMTP-рассылки, 2 экрана, тест | 1,5 дня |

Каждый этап — отдельный коммит в ветке `admin-expansion`, после этапа собирается `web/dist` и выполняется деплой. Порядок A → B → C → D: A даёт ежедневную пользу, дальше аналитика, безопасность, монетизация.

## 17. Деплой и откат

1. Бэкап: `deploy/backup.sh` (БД + файлы).
2. `npm --prefix web run build`, затем `scp -r server/src web/dist` на сервер.
3. `npm install --omit=dev` (для D добавится nodemailer), `systemctl restart code-qr`.
4. Миграции применяются при старте автоматически, до запуска сервера; при ошибке процесс падает и старая версия остаётся в systemd-логе.
5. Откат: восстановить БД из бэкапа, `git checkout` предыдущего коммита, повторить деплой.

## 18. Риски и открытые вопросы

**Риски.** Миграции на боевой БД (снимаем бэкап, таблицы маленькие); новая зависимость nodemailer (только этап D); блокировка 2FA (резервные коды + скрипт сброса); доставляемость писем (SPF/DKIM — вне кода); рост `audit_log` (чистка раз в сутки).

**Нужно подтвердить:**
1. Роль `support` нужна или достаточно одного admin?
2. Возврат средств всегда снимает PREMIUM или это галочка? (в плане — галочка, по умолчанию включена)
3. Удаление клиента — полное или анонимизация с сохранением финансовой истории? (в плане — полное, с подтверждением)
4. 2FA — обязательна для admin или по желанию? (в плане — по желанию, с напоминанием)
5. Рассылки — свой SMTP или внешний сервис (Unisender/Mailgun)? (в плане — свой SMTP)

## 19. Статус

- [x] **Этап A — клиенты и платежи** (ветка `admin-expansion`): миграция v7, API клиентов и заказов, экраны «Обзор», «Клиенты», «Карточка», «Платежи», «Настройки», принудительная смена временного пароля, тест `scripts/test-admin-a.mjs` (34 проверки).
- [ ] Этап B — аналитика и здоровье сервиса.
- [ ] Этап C — аудит, роли, сессии, 2FA.
- [ ] Этап D — промокоды, лимиты тарифов, рассылки.

Колонки `orders.discount` и `orders.promo_code` из v9 добавляются вместе с промокодами на этапе D; этап A их не использует.

