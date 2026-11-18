# CODE QR PRO

SaaS-платформа для генерации GS1 DataMatrix («Честный ЗНАК»), пакетной обработки, редактора этикеток и печати.

- Домен: https://code-qr.stockcity.ru
- Стек: Node 20+ / Fastify / SQLite (better-sqlite3) / bwip-js / Vue 3 + Vite + Tailwind
- Деплой: /opt/code-qr, systemd code-qr.service (127.0.0.1:3100), nginx vhost + certbot

## Разработка
\`\`\`
npm --prefix server install
npm --prefix web install
npm run dev:server   # API :3100
npm run dev:web      # Vite :5173 (proxy /api -> :3100)
\`\`\`

## Этапы
1. Foundation — каркас, auth, ЛК, FREE/PREMIUM (текущий)
2. DataMatrix Engine — импорт CSV/XLSX, валидация GS1, генерация, экспорт
3. Label & Print — редактор этикеток, термопринтеры, Windows Print Bridge
4. Billing & API — оплата (контур ECLIPSE), подписки, Честный ЗНАК, админка
5. Production Release — тесты, безопасность, SSL, запуск
