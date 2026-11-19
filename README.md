# CODE QR PRO

SaaS-платформа для генерации GS1 DataMatrix («Честный ЗНАК»), пакетной обработки, редактора этикеток и печати на термопринтерах.

**Продакшен:** https://code-qr.stockcity.ru
**Стек:** Node 20+ / Fastify / SQLite (better-sqlite3, WAL) / bwip-js / Vue 3 + Vite + Tailwind
**Деплой:** /opt/code-qr, systemd code-qr.service (127.0.0.1:3100), nginx vhost + Let's Encrypt (автопродление)

## Возможности (этапы 1–5 завершены)

- **Auth и тарифы:** email+пароль (scrypt, httpOnly-сессии), FREE (50 кодов/день, пакет 20) / PREMIUM (1990 ₽/30 дней, 10000/день, пакет 5000). Первый зарегистрированный аккаунт = админ.
- **DataMatrix Engine:** импорт CSV/XLSX/TXT и PDF (текстовый слой или распознавание DataMatrix со страниц), валидация GS1 (AI, FNC1, контрольная цифра GTIN, криптохвост 91/92), пакетная генерация bwip-js (ECC200), экспорт PNG/SVG/ZIP/PDF А4.
- **Label & Print:** canvas-редактор этикеток (мм, DPI 203/300, шаблоны), PDF-листы, Windows Print Bridge (print-bridge/, localhost:9101, токен, GDI+ печать через драйвер Windows).
- **Billing:** YooKassa (redirect, чек 54-ФЗ), предоплата 30 дней, продление, polling статуса 30 с + кнопка «Проверить». Ключи: /opt/code-qr/server/.env (chmod 600).
- **Честный ЗНАК:** локальная валидация кодов + интеграционный слой ГИС МТ (онлайн-проверка требует УКЭП; настройки в админке).
- **API для 1С:** ключи X-API-Key (sha256), POST /api/v1/generate, GET /api/v1/jobs/{id}, GET /api/v1/me.
- **Безопасность:** rate-limit (auth 10/мин, глобально 300/мин), security-заголовки + HSTS, body limit 8 МБ, защита от path traversal, изоляция от ECLIPSE.

## Админка (`/app/admin`)

Разделы: **Обзор** (выручка, MRR, конверсия, графики, здоровье сервиса), **Клиенты** (поиск, карточка, выдача PREMIUM на любой срок, блокировка, сброс пароля, удаление), **Платежи** (ручное подтверждение, отмена, возврат через ЮKassa, CSV), **Задания** (очередь, повтор, удаление), **Маркетинг** (промокоды, рассылки по сегментам), **Журнал** (аудит действий), **Настройки** (лимиты тарифов, 2FA, SMTP, Честный ЗНАК).

Роль `support` видит клиентов и задания, но не деньги, настройки и журнал. 2FA — TOTP без внешних зависимостей, аварийный сброс: `node scripts/reset-2fa.mjs email`.


## Разработка

```bash
npm --prefix server install
npm --prefix web install
npm run dev:server   # API :3100
npm run dev:web      # Vite :5173 (proxy /api)
npm run build        # web/dist
```

## Тесты (при запущенном сервере :3100)

```bash
node scripts/test-stage2.mjs   # генерация/экспорт
node scripts/test-stage3.mjs   # этикетки/шаблоны
node scripts/test-stage5.mjs   # безопасность (rate-limit исчерпывает лимит IP на 1 мин)
node scripts/test-admin-a.mjs  # админка: клиенты, блокировка, пароли, заказы
node scripts/test-admin-b.mjs  # аналитика, здоровье, задания
node scripts/test-admin-c.mjs  # аудит, роли, 2FA
node scripts/test-admin-d.mjs  # промокоды, лимиты тарифов, SMTP, рассылки
# этап 4 — на отдельном сервере с чистой БД:
set PORT=3101 DB_PATH=server/data/test4.db JOBS_DIR=server/data/test4-jobs && node server/src/index.js
node scripts/test-stage4.mjs
# Print Bridge:
node print-bridge/bridge.mjs   # в другом окне
node scripts/test-bridge.mjs
```

## Деплой

```bash
scp -r server/src server/package.json 2.27.86.180:/opt/code-qr/server/
scp -r web/dist 2.27.86.180:/opt/code-qr/web/
ssh 2.27.86.180 "cd /opt/code-qr/server && npm install --omit=dev && systemctl restart code-qr"
```

Первичная установка: deploy/deploy.sh (systemd + nginx + certbot).
Бэкапы: deploy/backup.sh (cron 03:30, /opt/backups/code-qr, AES-256-GCM `.enc`, проверка восстановлением, хранение 14 дней). Ключ шифрования `.app-key` храните отдельно от бэкапов.

## Переменные окружения (server/.env)

YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, PUBLIC_URL, PORT, HOST, DB_PATH, JOBS_DIR, NODE_ENV=production.
