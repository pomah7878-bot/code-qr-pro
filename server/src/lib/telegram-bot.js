import { db } from '../db.js';
import { getSetting, setSetting } from '../settings.js';
import { tgConfigured, tgIsAdmin, tgSendMessage, tgSendDocument, tgAnswerCallback, tgGetUpdates, tgDeleteWebhook, tgGetMe } from './telegram-api.js';
import { generateInvoicePdf } from './invoice.js';
import { confirmOrderManually, cancelInvoiceOrderManually } from './order-actions.js';
import { notifyStatusChange } from '../notify.js';
import { logEvent } from './app-log.js';

const PUBLIC_URL = String(process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru').replace(/\/+$/, '');
const ADMIN_PANEL = PUBLIC_URL + '/app/admin';
let polling = false;
let botMe = null;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n) => Number(n || 0).toLocaleString('ru-RU');
const dt = (v) => {
  if (!v) return '—';
  const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const planName = (o) => String(o?.plan_title || o?.plan || '').toUpperCase() || '—';

const mainMenu = () => ({
  inline_keyboard: [
    [{ text: '📊 Статистика', callback_data: 'menu:stats' }, { text: '💳 Ожидают оплаты', callback_data: 'menu:orders' }],
    [{ text: '🧾 Счета юрлиц', callback_data: 'menu:invoices' }, { text: '👥 Клиенты', callback_data: 'menu:users' }],
    [{ text: '🎫 Обращения', callback_data: 'menu:tickets' }, { text: '⚠️ Задания', callback_data: 'menu:jobs' }],
    [{ text: '🌐 Админ-панель', url: ADMIN_PANEL }]
  ]
});

const helpText = () => '🤖 <b>Админ-бот CODE QR PRO</b>\n\n' +
  'Команды:\n' +
  '/stats — сводка сервиса\n' +
  '/orders — заказы, ожидающие оплаты\n' +
  '/invoices — счета юрлиц\n' +
  '/order &lt;id&gt; — карточка заказа\n' +
  '/invoice &lt;id&gt; — отправить PDF счёта\n' +
  '/users — последние клиенты\n' +
  '/user &lt;email или id&gt; — карточка клиента\n' +
  '/tickets — обращения в поддержку\n' +
  '/jobs — ошибки и задания\n' +
  '/menu — меню с кнопками\n\n' +
  'Уведомления о новых счетах, оплатах, отменах, обращениях и регистрациях приходят автоматически.';

async function send(chatId, text, options = {}) {
  return tgSendMessage(chatId, text, options);
}

function orderButtons(order) {
  const rows = [];
  if (order.status === 'pending') {
    rows.push([{ text: '✅ Подтвердить оплату', callback_data: 'ord:confirmask:' + order.id }]);
    if (order.payment_method === 'bank_transfer' || order.provider === 'invoice') {
      rows.push([{ text: '📄 PDF счёта', callback_data: 'ord:doc:' + order.id }, { text: '❌ Отменить счёт', callback_data: 'ord:cancel:' + order.id }]);
    }
  }
  rows.push([{ text: '🌐 Открыть в админке', url: ADMIN_PANEL + '/orders' }]);
  return { inline_keyboard: rows };
}

function orderCard(order) {
  return '📦 <b>Заказ №' + order.id + '</b>\n' +
    'Статус: <b>' + esc(order.status) + '</b>\n' +
    '📧 ' + esc(order.email || ('user ' + order.user_id)) + '\n' +
    (order.company_name ? '🏢 ' + esc(order.company_name) + '\nИНН ' + esc(order.company_inn || '—') + (order.company_kpp ? ' / КПП ' + esc(order.company_kpp) : '') + '\n' : '') +
    '📦 ' + esc(planName(order)) + ' · ' + (order.days || 0) + ' дн.\n' +
    '💵 <b>' + money(order.amount) + ' ₽</b>\n' +
    (order.invoice_number ? '🧾 Счёт ' + esc(order.invoice_number) + ' · ' + esc(order.payment_method === 'bank_transfer' ? 'банковский перевод' : order.payment_method) + '\n' : '') +
    '🕒 Создан: ' + dt(order.created_at) + (order.paid_at ? '\n✅ Оплачен: ' + dt(order.paid_at) : '');
}

async function showStats(chatId) {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const paidUsers = db.prepare("SELECT COUNT(DISTINCT user_id) c FROM subscriptions WHERE status='active' AND expires_at > datetime('now')").get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) c FROM orders WHERE status='paid'").get().c;
  const revenue30 = db.prepare("SELECT COALESCE(SUM(amount),0) c FROM orders WHERE status='paid' AND paid_at > datetime('now','-30 days')").get().c;
  const pending = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM orders WHERE status='pending'").get();
  const invoices = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending' AND payment_method='bank_transfer'").get().c;
  const tickets = db.prepare("SELECT COUNT(*) c FROM support_tickets WHERE status IN ('open','in_progress')").get().c;
  const jobsErr = db.prepare("SELECT COUNT(*) c FROM generation_jobs WHERE status='error' AND created_at > datetime('now','-24 hours')").get().c;
  const openTickets = db.prepare("SELECT status, COUNT(*) c FROM support_tickets GROUP BY status").all();
  const text = '📊 <b>Сводка CODE QR PRO</b>\n\n' +
    '👥 Пользователей: <b>' + totalUsers + '</b> · активных подписок: <b>' + paidUsers + '</b>\n' +
    '💰 Выручка всего: <b>' + money(revenue) + ' ₽</b> · за 30 дней: <b>' + money(revenue30) + ' ₽</b>\n' +
    '⏳ Ожидают оплаты: <b>' + pending.c + '</b> на ' + money(pending.s) + ' ₽ · счетов юрлиц: ' + invoices + '\n' +
    '🎫 Обращений: <b>' + tickets + '</b> (' + openTickets.map((x) => x.status + ': ' + x.c).join(', ') + ')\n' +
    '⚠️ Ошибок заданий за 24ч: <b>' + jobsErr + '</b>\n' +
    '🕒 ' + new Date().toLocaleString('ru-RU');
  return send(chatId, text, { reply_markup: mainMenu() });
}

async function showOrders(chatId, { onlyInvoices = false } = {}) {
  const where = onlyInvoices
    ? "o.status='pending' AND o.payment_method='bank_transfer'"
    : "o.status='pending'";
  const rows = db.prepare(`SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE ${where} ORDER BY o.id DESC LIMIT 8`).all();
  if (!rows.length) return send(chatId, onlyInvoices ? '🧾 Нет неоплаченных счетов.' : '✅ Нет заказов, ожидающих оплаты.', { reply_markup: mainMenu() });
  await send(chatId, (onlyInvoices ? '🧾 <b>Неоплаченные счета юрлиц</b>' : '💳 <b>Заказы, ожидающие оплаты</b>') + '\nВсего: ' + rows.length, { reply_markup: mainMenu() });
  for (const order of rows) {
    await send(chatId, orderCard(order), { reply_markup: orderButtons(order) });
  }
}

async function showOrder(chatId, id) {
  const order = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(id));
  if (!order) return send(chatId, 'Заказ №' + id + ' не найден.');
  return send(chatId, orderCard(order), { reply_markup: orderButtons(order) });
}

async function sendInvoiceDocument(chatId, orderId) {
  const order = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(orderId));
  if (!order || order.buyer_type !== 'legal') throw new Error('Это не счёт юрлица');
  const pdf = await generateInvoicePdf({ ...order, buyer_email: order.email || '' });
  await send(chatId, '🧾 Счёт № ' + esc(order.invoice_number || order.id) + ' · ' + money(order.amount) + ' ₽\n' + esc(order.company_name || ''));
  await tgSendDocument(chatId, pdf, 'invoice-' + order.id + '.pdf', 'Счёт № ' + (order.invoice_number || order.id));
}

function userCard(user) {
  const sub = db.prepare("SELECT plan, expires_at FROM subscriptions WHERE user_id=? AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1").get(user.id);
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) c FROM orders WHERE user_id=? AND status='paid'").get(user.id).c;
  const jobs = db.prepare('SELECT COUNT(*) c FROM generation_jobs WHERE user_id=?').get(user.id).c;
  return '👤 <b>' + esc(user.name || 'Без имени') + '</b>\n' +
    '📧 ' + esc(user.email) + '\n' +
    '🆔 ' + user.id + ' · роль <b>' + esc(user.role) + '</b> · статус <b>' + esc(user.status || 'active') + '</b>\n' +
    '📦 тариф: <b>' + esc(String(user.plan || '').toUpperCase()) + '</b>' + (sub ? ' до ' + dt(sub.expires_at) : '') + '\n' +
    '💰 оплачено всего: ' + money(paid) + ' ₽ · заданий: ' + jobs + '\n' +
    (user.trial_used ? '🧪 триал использован\n' : '') +
    '🕒 регистрация: ' + dt(user.created_at) + '\n' +
    '🕒 последний вход: ' + dt(user.last_login_at);
}

function userButtons(user) {
  const rows = [[{ text: '🌐 Карточка в админке', url: ADMIN_PANEL + '/users/' + user.id }]];
  if (user.role !== 'admin') {
    rows.unshift([user.status === 'blocked'
      ? { text: '✅ Разблокировать', callback_data: 'user:unblock:' + user.id }
      : { text: '🚫 Заблокировать', callback_data: 'user:blockask:' + user.id }]);
  }
  return { inline_keyboard: rows };
}

async function showUser(chatId, query) {
  const q = String(query || '').trim();
  if (!q) return showUsers(chatId);
  let user = /^\d+$/.test(q)
    ? db.prepare('SELECT * FROM users WHERE id=?').get(Number(q))
    : db.prepare("SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 1").get('%' + q + '%', '%' + q + '%');
  if (!user) return send(chatId, 'Клиент не найден: ' + esc(q));
  return send(chatId, userCard(user), { reply_markup: userButtons(user) });
}

async function showUsers(chatId) {
  const users = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 8').all();
  await send(chatId, '👥 <b>Последние клиенты</b>', { reply_markup: mainMenu() });
  for (const u of users) await send(chatId, userCard(u), { reply_markup: userButtons(u) });
}

async function blockUser(chatId, id, blocked) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
  if (!user) return send(chatId, 'Клиент не найден.');
  if (user.role === 'admin') return send(chatId, 'Администратора блокировать нельзя.');
  if (blocked) {
    db.transaction(() => {
      db.prepare("UPDATE users SET status='blocked', blocked_at=datetime('now') WHERE id=?").run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    })();
    notifyStatusChange(user, 'Аккаунт заблокирован администратором через Telegram-бота');
  } else {
    db.prepare("UPDATE users SET status='active', blocked_at=NULL, blocked_reason='' WHERE id=?").run(user.id);
    notifyStatusChange(user, 'Аккаунт разблокирован администратором через Telegram-бота');
  }
  logEvent({ level: 'info', source: 'telegram', event: blocked ? 'user.block' : 'user.unblock', message: user.email, meta: { userId: user.id } });
  return send(chatId, (blocked ? '🚫 Заблокирован: ' : '✅ Разблокирован: ') + esc(user.email), { reply_markup: userButtons(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
}

async function showTickets(chatId) {
  const rows = db.prepare(`SELECT t.*, u.email, u.name FROM support_tickets t JOIN users u ON u.id=t.user_id
    WHERE t.status IN ('open','in_progress') ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.id DESC LIMIT 8`).all();
  if (!rows.length) return send(chatId, '🎫 Открытых обращений нет.', { reply_markup: mainMenu() });
  await send(chatId, '🎫 <b>Обращения в поддержку</b>', { reply_markup: mainMenu() });
  for (const t of rows) {
    const text = '🎫 <b>Обращение #' + t.id + '</b> · ' + esc(t.status) + '\n' +
      '👤 ' + esc(t.name || '—') + ' · ' + esc(t.email) + '\n' +
      '📝 ' + esc(t.subject || '—') + '\n' +
      '💬 ' + esc(String(t.message || '').slice(0, 350)) + '\n🕒 ' + dt(t.created_at);
    const buttons = { inline_keyboard: [
      [{ text: '🛠 В работу', callback_data: 'ticket:progress:' + t.id }, { text: '✅ Закрыть', callback_data: 'ticket:close:' + t.id }],
      [{ text: '🌐 Открыть в админке', url: ADMIN_PANEL + '/support' }]
    ] };
    await send(chatId, text, { reply_markup: buttons });
  }
}

async function setTicketStatus(chatId, id, status) {
  const t = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(Number(id));
  if (!t) return send(chatId, 'Обращение не найдено.');
  db.prepare("UPDATE support_tickets SET status=?, updated_at=datetime('now') WHERE id=?").run(status, t.id);
  logEvent({ level: 'info', source: 'telegram', event: 'ticket.status', message: 'ticket #' + t.id + ' -> ' + status, meta: { ticketId: t.id } });
  return send(chatId, (status === 'closed' ? '✅ Обращение #' + t.id + ' закрыто' : '🛠 Обращение #' + t.id + ' в работе'), { reply_markup: mainMenu() });
}

async function showJobs(chatId) {
  const stats = db.prepare("SELECT status, COUNT(*) c FROM generation_jobs GROUP BY status").all();
  const errors = db.prepare("SELECT j.id, j.user_id, j.status, j.error, j.created_at, u.email FROM generation_jobs j LEFT JOIN users u ON u.id=j.user_id WHERE j.status='error' ORDER BY j.id DESC LIMIT 8").all();
  const text = '⚠️ <b>Задания</b>\n\n' + stats.map((s) => esc(s.status) + ': <b>' + s.c + '</b>').join('\n') +
    '\n\nПоследние ошибки:\n' + (errors.length ? errors.map((e) => '#' + e.id + ' · ' + esc(e.email || e.user_id) + ' · ' + dt(e.created_at) + '\n' + esc(String(e.error || '').slice(0, 140))).join('\n\n') : 'нет');
  return send(chatId, text, { reply_markup: { inline_keyboard: [[{ text: '🌐 Задания в админке', url: ADMIN_PANEL + '/jobs' }]] } });
}

async function handleCommand(chatId, text) {
  const [cmdRaw, ...rest] = String(text || '').trim().split(/\s+/);
  const cmd = String(cmdRaw || '').split('@')[0].toLowerCase();
  const arg = rest.join(' ').trim();
  if (cmd === '/start' || cmd === '/menu') return send(chatId, helpText(), { reply_markup: mainMenu() });
  if (cmd === '/help') return send(chatId, helpText(), { reply_markup: mainMenu() });
  if (cmd === '/stats') return showStats(chatId);
  if (cmd === '/orders') return showOrders(chatId);
  if (cmd === '/invoices') return showOrders(chatId, { onlyInvoices: true });
  if (cmd === '/order') return showOrder(chatId, arg);
  if (cmd === '/invoice') return sendInvoiceDocument(chatId, arg);
  if (cmd === '/users') return showUsers(chatId);
  if (cmd === '/user') return showUser(chatId, arg);
  if (cmd === '/tickets') return showTickets(chatId);
  if (cmd === '/jobs') return showJobs(chatId);
  if (cmd === '/id') return send(chatId, 'chat_id: <code>' + chatId + '</code>');
  return send(chatId, 'Не понял команду.\n\n' + helpText(), { reply_markup: mainMenu() });
}

export async function handleTelegramUpdate(update) {
  if (!update) return;
  try {
    if (update.message?.chat?.id) {
      const chatId = String(update.message.chat.id);
      if (!tgIsAdmin(chatId)) {
        if (update.message.text) send(chatId, '⛔ Доступ только для администратора.\nВаш chat_id: <code>' + chatId + '</code>');
        return;
      }
      if (update.message.text) await handleCommand(chatId, update.message.text);
      return;
    }
    if (update.callback_query?.message?.chat?.id) {
      const cb = update.callback_query;
      const chatId = String(cb.message.chat.id);
      if (!tgIsAdmin(chatId)) { await tgAnswerCallback(cb.id, 'Нет доступа'); return; }
      const data = String(cb.data || '');
      const [group, action, id] = data.split(':');
      await tgAnswerCallback(cb.id, '');
      if (group === 'menu') {
        if (action === 'stats') return showStats(chatId);
        if (action === 'orders') return showOrders(chatId);
        if (action === 'invoices') return showOrders(chatId, { onlyInvoices: true });
        if (action === 'users') return showUsers(chatId);
        if (action === 'tickets') return showTickets(chatId);
        if (action === 'jobs') return showJobs(chatId);
      }
      if (group === 'ord') {
        if (action === 'view') return showOrder(chatId, id);
        if (action === 'doc') return sendInvoiceDocument(chatId, id);
        if (action === 'confirmask') {
        const preview = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(id));
        if (!preview) return send(chatId, 'Заказ не найден.');
        return send(chatId, 'Подтвердить оплату заказа №' + id + ' на <b>' + money(preview.amount) + ' ₽</b>?\n' +
          esc(preview.email) + ' · ' + esc(planName(preview)) + ' · ' + esc(preview.status), {
          reply_markup: { inline_keyboard: [[{ text: '✅ Да, подтвердить', callback_data: 'ord:confirm:' + id }, { text: 'Отмена', callback_data: 'ord:view:' + id }]] }
        });
      }
      if (action === 'confirm') {
          try {
            const r = confirmOrderManually(id, 'telegram');
            return send(chatId, (r.already ? 'Заказ уже оплачен.' : '✅ Оплата подтверждена, тариф активирован.') + '\n\n' + orderCard(db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(id))), { reply_markup: mainMenu() });
          } catch (e) { return send(chatId, '❌ ' + esc(e.message)); }
        }
        if (action === 'cancel') {
          try { cancelInvoiceOrderManually(id, 'telegram'); return send(chatId, '❌ Счёт №' + id + ' отменён.', { reply_markup: mainMenu() }); }
          catch (e) { return send(chatId, '❌ ' + esc(e.message)); }
        }
      }
      if (group === 'user') {
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
        if (!user) return send(chatId, 'Клиент не найден.');
        if (action === 'view') return send(chatId, userCard(user), { reply_markup: userButtons(user) });
        if (action === 'blockask') {
          return send(chatId, 'Заблокировать ' + esc(user.email) + '?\nСессии будут завершены.', { reply_markup: { inline_keyboard: [[{ text: '🚫 Да, заблокировать', callback_data: 'user:block:' + user.id }, { text: 'Отмена', callback_data: 'user:view:' + user.id }]] } });
        }
        if (action === 'block') return blockUser(chatId, id, true);
        if (action === 'unblock') return blockUser(chatId, id, false);
      }
      if (group === 'ticket') {
        if (action === 'view') return showTickets(chatId);
        if (action === 'progress') return setTicketStatus(chatId, id, 'in_progress');
        if (action === 'close') return setTicketStatus(chatId, id, 'closed');
      }
    }
  } catch (e) {
    console.error('telegram bot update failed:', String(e?.message || e));
    logEvent({ level: 'warn', source: 'telegram', event: 'bot_update_failed', message: String(e?.message || e).slice(0, 300) });
  }
}

export function startTelegramBot() {
  if (!tgConfigured()) {
    console.log('telegram bot: TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_ID not configured');
    return;
  }
  if (polling) return;
  polling = true;
  let offset = Number(getSetting('telegram_offset', '0')) || 0;
  const log = (m) => { console.log('telegram bot:', m); logEvent({ level: 'info', source: 'telegram', event: 'bot', message: String(m).slice(0, 300) }); };
  const loop = async () => {
    try {
      const updates = await tgGetUpdates(offset);
      for (const update of updates) {
        offset = Number(update.update_id) + 1;
        setSetting('telegram_offset', String(offset));
        handleTelegramUpdate(update).catch((e) => console.error('telegram handler:', String(e?.message || e)));
      }
    } catch (e) {
      const msg = String(e?.message || e);
      // 409 Conflict обычно означает, что у бота установлен webhook — попробуем убрать.
      if (/409|webhook/i.test(msg)) {
        log('polling conflict, deleting webhook');
        await tgDeleteWebhook();
      } else console.error('telegram getUpdates:', msg.slice(0, 200));
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      if (polling) setTimeout(loop, 1200);
    }
  };
  (async () => {
    try { await tgGetMe(); } catch { /* ignore */ }
    try { await tgDeleteWebhook(); } catch { /* ignore */ }
    log('admin bot polling started');
    loop();
  })();
}

export function stopTelegramBot() {
  polling = false;
}
