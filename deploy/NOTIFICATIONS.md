# Уведомления администратору (Telegram)

CODE QR PRO шлёт админу уведомления в Telegram о:
- 🆕 новой регистрации (email, имя, тариф, всего пользователей)
- 💰 оплате заказа (тариф, сумма, № заказа, провайдер)
- ❌ отмене заказа
- 🔄 смене статуса (выдача/снятие PREMIUM админом, истечение подписки)

## Настройка

1. Создайте бота через @BotFather (/newbot) или используйте существующего.
2. Узнайте свой Telegram ID (напишите @userinfobot).
3. Добавьте в /opt/code-qr/server/.env:
   ```
   TELEGRAM_BOT_TOKEN=123456789:AA...
   TELEGRAM_ADMIN_ID=123456789
   ```
4. chmod 600 /opt/code-qr/server/.env
5. systemctl restart code-qr
6. В логе: billing ready { telegramNotify: true }

Без токена уведомления молча пропускаются (notifyConfigured() = false) — сайт работает照常.

## Безопасность
- Токен только в .env (chmod 600), не в коде и не в git.
- Отправка fire-and-forget: ошибка Telegram не ломает регистрацию/оплату.
- HTML-экранирование пользовательских данных (email, имя).
