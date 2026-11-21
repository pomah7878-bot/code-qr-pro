// Уведомления администратору в Telegram (бот CODE QR PRO).
// Конфиг: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_ID (несколько ID через запятую).
import { logEvent } from './lib/app-log.js';
import { tgConfigured, tgAdminIds, tgSendMessage, tgSendDocument } from './lib/telegram-api.js';
import { generateInvoicePdf } from './lib/invoice.js';

export const notifyConfigured = tgConfigured;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PLAN_TITLE = (order) => String(order?.plan_title || order?.plan || 'тариф').slice(0, 120);
const money = (n) => Number(n || 0).toLocaleString('ru-RU');
const orderStatus = { pending: 'ожидает оплаты', paid: 'оплачен', canceled: 'отменён', refunded: 'возврат' };
const adminUrl = (path) => String(process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru').replace(/\/+$/, '') + '/app/admin' + path;

async function send(text, options = {}) {
  if (!tgConfigured()) return false;
  let ok = false;
  for (const chatId of tgAdminIds()) {
    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await tgSendMessage(chatId, text, options);
        ok = true;
        lastError = '';
        break;
      } catch (e) {
        lastError = String(e?.message || e);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (lastError) {
      console.error('telegram notify failed:', lastError);
      logEvent({ level: 'warn', source: 'notify', event: 'telegram_failed', message: `Telegram: ${lastError.slice(0, 300)}`, meta: { text: String(text).slice(0, 120) } });
    }
  }
  return ok;
}

async function sendDocument(buffer, filename, caption, options = {}) {
  if (!tgConfigured()) return false;
  const ids = tgAdminIds();
  for (const chatId of ids) {
    try { await tgSendDocument(chatId, buffer, filename, caption, options); } catch (e) {
      console.error('telegram document failed:', String(e?.message || e));
    }
  }
  return ids.length > 0;
}

export function notifyRegistration(user, totalUsers) {
  return send('🆕 <b>Новая регистрация</b> CODE QR PRO\n' +
    '👤 ' + esc(user.name || '—') + '\n📧 ' + esc(user.email) + '\n' +
    '🆔 id ' + user.id + ' · тариф ' + esc(String(user.plan || '').toUpperCase()) + '\n' +
    '👥 Всего пользователей: <b>' + totalUsers + '</b>', {
    reply_markup: { inline_keyboard: [[{ text: '👤 Карточка клиента', callback_data: 'user:view:' + user.id }], [{ text: '🌐 Админка', url: adminUrl('/users/' + user.id) }]] }
  });
}

export function notifyPayment(order, user) {
  const isInvoice = order?.payment_method === 'bank_transfer' || order?.provider === 'invoice';
  return send((isInvoice ? '✅' : '💰') + ' <b>' + (isInvoice ? 'Счёт оплачен' : 'Оплата получена') + '</b> CODE QR PRO\n' +
    '📧 ' + esc(user?.email || 'id ' + order?.user_id) + '\n' +
    (order?.company_name ? '🏢 ' + esc(order.company_name) + ' · ИНН ' + esc(order.company_inn || '—') + '\n' : '') +
    '📦 ' + esc(PLAN_TITLE(order)) + ' на ' + (order?.days || 30) + ' дн.\n' +
    '💵 Сумма: <b>' + money(order?.amount) + ' ₽</b>\n' +
    '🧾 Заказ №' + order?.id + (order?.invoice_number ? ' · счёт ' + esc(order.invoice_number) : '') + '\n' +
    '✅ Статус: <b>оплачен</b>', {
    reply_markup: { inline_keyboard: [
      [{ text: '📦 Открыть заказ', callback_data: 'ord:view:' + order?.id }],
      [{ text: '🌐 Платежи в админке', url: adminUrl('/orders') }]
    ] }
  });
}

/** Автоматическое уведомление о выставленном счёте + PDF документа. */
export async function notifyInvoiceCreated(order) {
  if (!order) return;
  const user = order.buyer_email || '';
  const caption = '🧾 <b>Выставлен счёт</b> CODE QR PRO\n' +
    '№ ' + esc(order.invoice_number || ('СЧ-' + order.id)) + ' от ' + String(order.invoice_issued_at || order.created_at || '').slice(0, 10) + '\n' +
    (order.company_name ? '🏢 ' + esc(order.company_name) + '\nИНН ' + esc(order.company_inn || '—') + (order.company_kpp ? ' / КПП ' + esc(order.company_kpp) : '') + '\n' : '') +
    '📦 ' + esc(PLAN_TITLE(order)) + ' на ' + (order.days || 30) + ' дн.\n' +
    '💵 <b>' + money(order.amount) + ' ₽</b> · без НДС (НПД)\n' +
    '📌 Статус: <b>ожидает оплаты</b> банковским переводом' +
    (user ? '\n📧 ' + esc(user) : '');
  const markup = { inline_keyboard: [
    [{ text: '✅ Подтвердить оплату', callback_data: 'ord:confirm:' + order.id }, { text: '📄 PDF счёта', callback_data: 'ord:doc:' + order.id }],
    [{ text: '📦 Заказ в боте', callback_data: 'ord:view:' + order.id }, { text: '🌐 Админка', url: adminUrl('/orders') }]
  ] };
  await send(caption, { reply_markup: markup });
  try {
    const pdf = await generateInvoicePdf(order);
    await sendDocument(pdf, `invoice-${order.id}.pdf`, `Счёт № ${order.invoice_number || order.id} · ${money(order.amount)} ₽`, { reply_markup: markup });
  } catch (e) {
    logEvent({ level: 'warn', source: 'notify', event: 'invoice_pdf_failed', message: String(e?.message || e).slice(0, 200), meta: { orderId: order.id } });
  }
}

export function notifyInvoicePaid(order, user) {
  return notifyPayment({ ...order, payment_method: 'bank_transfer', provider: 'invoice' }, user);
}

export function notifyStatusChange(user, change) {
  send('🔄 <b>Статус изменён</b> CODE QR PRO\n' +
    '📧 ' + esc(user?.email || '—') + '\n' + esc(change));
}

export function notifyOrderCanceled(order, user) {
  send('❌ <b>Заказ отменён</b> CODE QR PRO\n' +
    '📧 ' + esc(user?.email || 'id ' + order.user_id) + '\n' +
    (order?.company_name ? '🏢 ' + esc(order.company_name) + '\n' : '') +
    '📦 ' + esc(PLAN_TITLE(order)) + ' · ' + money(order.amount) + ' ₽ · заказ №' + order.id +
    '\n📌 Статус: <b>' + (orderStatus[order.status] || order.status) + '</b>', {
    reply_markup: { inline_keyboard: [[{ text: '📦 Заказ', callback_data: 'ord:view:' + order.id }]] }
  });
}

/** Клиент попросил живую поддержку (обращение из AI-помощника). */
export function notifySupportTicket(ticket, user, link) {
  const msg = String(ticket?.message || '');
  return send('🆘 <b>Новое обращение в поддержку</b> CODE QR PRO\n' +
    '👤 ' + esc(user?.name || '—') + '\n' +
    '📧 ' + esc(user?.email || '—') + '\n' +
    '📝 ' + esc(ticket?.subject || '—') + '\n' +
    '💬 ' + esc(msg.slice(0, 300)) + (msg.length > 300 ? '…' : '') + '\n' +
    '🆔 #' + ticket?.id, {
    reply_markup: { inline_keyboard: [
      [{ text: '🛠 В работу', callback_data: 'ticket:progress:' + ticket?.id }, { text: '✅ Закрыть', callback_data: 'ticket:close:' + ticket?.id }],
      [{ text: '🎫 Открыть обращение', callback_data: 'ticket:view:' + ticket?.id }].concat(link ? [{ text: '🌐 Админка', url: link }] : [])
    ] }
  });
}
