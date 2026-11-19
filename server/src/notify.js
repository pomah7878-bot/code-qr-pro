// Уведомления администратору в Telegram (отдельный бот CODE QR PRO).
// Конфиг через .env: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_ID. Без зависимостей — fetch.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID || '';

export const notifyConfigured = () => Boolean(TOKEN && ADMIN_ID);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function send(text) {
  if (!notifyConfigured()) return;
  try {
    const res = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      console.error('telegram notify failed:', d.description || res.status);
    }
  } catch (e) {
    console.error('telegram notify error:', String(e?.message || e));
  }
}

export function notifyRegistration(user, totalUsers) {
  send('🆕 <b>Новая регистрация</b> CODE QR PRO\n' +
    '👤 ' + esc(user.name || '—') + '\n📧 ' + esc(user.email) + '\n' +
    '🆔 id ' + user.id + ' · тариф ' + esc(String(user.plan).toUpperCase()) + '\n' +
    '👥 Всего пользователей: <b>' + totalUsers + '</b>');
}

export function notifyPayment(order, user) {
  const emoji = order.plan === 'test' ? '🧪' : '💰';
  send(emoji + ' <b>Оплата получена</b> CODE QR PRO\n' +
    '📧 ' + esc(user?.email || 'id ' + order.user_id) + '\n' +
    '📦 Тариф: <b>' + esc(String(order.plan).toUpperCase()) + '</b>\n' +
    '💵 Сумма: <b>' + order.amount + ' ₽</b>\n' +
    '🧾 Заказ №' + order.id + ' · ' + esc(order.provider) + '\n' +
    (order.plan === 'archive' ? '✅ Архив активирован на ' + (order.days || 1095) + ' дней' : '✅ PREMIUM активирован на 30 дней'));
}

export function notifyStatusChange(user, change) {
  send('🔄 <b>Статус изменён</b> CODE QR PRO\n' +
    '📧 ' + esc(user?.email || '—') + '\n' + esc(change));
}

export function notifyOrderCanceled(order, user) {
  send('❌ <b>Заказ отменён</b> CODE QR PRO\n' +
    '📧 ' + esc(user?.email || 'id ' + order.user_id) + '\n' +
    '📦 ' + esc(String(order.plan).toUpperCase()) + ' · ' + order.amount + ' ₽ · заказ №' + order.id);
}
