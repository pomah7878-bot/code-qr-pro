import { readdirSync, statSync, statfsSync } from 'node:fs';
import { db } from '../db.js';
import { getSetting, setSetting } from '../settings.js';
import {
  tgConfigured, tgIsAdmin, tgSendMessage, tgSendDocument, tgAnswerCallback,
  tgGetUpdates, tgDeleteWebhook, tgGetMe, tgSetMyCommands
} from './telegram-api.js';
import { generateInvoicePdf } from './invoice.js';
import { confirmOrderManually, cancelInvoiceOrderManually } from './order-actions.js';
import { adminAssign, extendSubscription, startTrial } from './subscription.js';
import { issueNpdReceiptForOrder, resendNpdReceipt, npdSettings } from './npd-receipt.js';
import { notifyStatusChange } from '../notify.js';
import { logEvent } from './app-log.js';
import { smtpConfigured } from './mailer.js';
import { consumeMarketplaceTgToken } from './marketplace-telegram.js';
import { providerConfigured } from '../billing.js';

const PUBLIC_URL = String(process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru').replace(/\/+$/, '');
const ADMIN_PANEL = PUBLIC_URL + '/app/admin';
const BACKUP_DIR = process.env.BACKUP_DIR || '/opt/backups/code-qr';
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
const fmtBytes = (b) => {
  const n = Number(b) || 0;
  if (!n) return '0';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};
const fmtUptime = (s) => {
  const d = Math.floor(Number(s || 0) / 86400);
  const h = Math.floor((Number(s || 0) % 86400) / 3600);
  return d ? `${d} д ${h} ч` : `${h} ч`;
};
const statusIcon = (s) => s === 'paid' ? '✅' : s === 'pending' ? '⏳' : s === 'canceled' ? '⛔' : s === 'refunded' ? '↩️' : '•';
const menuBack = () => ({ inline_keyboard: [[{ text: '⬅️ Главное меню', callback_data: 'menu:main' }]] });

const mainMenu = () => ({
  inline_keyboard: [
    [{ text: '📊 Сводка', callback_data: 'menu:stats' }, { text: '👥 Клиенты', callback_data: 'menu:users:0' }],
    [{ text: '💳 Ждут оплаты', callback_data: 'menu:orders:0' }, { text: '🧾 Счета юрлиц', callback_data: 'menu:invoices:0' }],
    [{ text: '🎫 Поддержка', callback_data: 'menu:tickets' }, { text: '⚠️ Задания', callback_data: 'menu:jobs' }],
    [{ text: '🖥 Система', callback_data: 'menu:system' }, { text: '🌐 Админка', url: ADMIN_PANEL }]
  ]
});

const helpText = () => '👑 <b>CODE QR PRO · Админ-центр</b>\n\n' +
  '📊 <b>Основное</b>\n' +
  '/stats — сводка сервиса\n' +
  '/orders — заказы, ожидающие оплаты\n' +
  '/invoices — счета юрлиц\n' +
  '/users — клиенты по страницам\n' +
  '/user &lt;email или id&gt; — карточка клиента\n' +
  '/order &lt;id&gt; — карточка заказа\n' +
  '/invoice &lt;id&gt; — отправить PDF счёта\n' +
  '/find &lt;email/id/номер&gt; — поиск клиента или заказа\n\n' +
  '🛠 <b>Эксплуатация</b>\n' +
  '/tickets — обращения поддержки\n' +
  '/jobs — очередь и ошибки заданий\n' +
  '/system — сервер, интеграции, бэкап, обслуживание\n' +
  '/menu — главное меню\n' +
  '/id — ваш chat_id\n\n' +
  'Опасные действия подтверждаются кнопкой. Все операции пишутся в журнал.';

async function send(chatId, text, options = {}) {
  return tgSendMessage(chatId, text, options);
}

async function back(chatId) {
  return send(chatId, '👑 <b>Админ-центр CODE QR PRO</b>\nВыберите раздел:', { reply_markup: mainMenu() });
}

function orderButtons(order) {
  const rows = [];
  if (order.status === 'pending') {
    rows.push([{ text: '✅ Подтвердить оплату', callback_data: 'ord:confirmask:' + order.id }]);
    if (order.provider === 'invoice' || order.payment_method === 'bank_transfer') {
      rows.push([{ text: '📄 PDF счёта', callback_data: 'ord:doc:' + order.id }, { text: '⛔ Отменить счёт', callback_data: 'ord:cancel:' + order.id }]);
    }
  }
  if (order.status === 'paid') {
    if (order.npd_receipt_url) {
      rows.push([{ text: '🧾 Открыть чек НПД', url: order.npd_receipt_url }, { text: '✉️ Отправить чек', callback_data: 'ord:resend:' + order.id }]);
    } else {
      rows.push([{ text: '🧾 Выпустить чек НПД', callback_data: 'ord:receiptask:' + order.id }]);
    }
  }
  if (order.yk_invoice_url && order.status === 'pending') rows.push([{ text: '💳 Онлайн-оплата', url: order.yk_invoice_url }]);
  rows.push([{ text: '🌐 Заказ в админке', url: ADMIN_PANEL + '/orders' }, { text: '⬅️ Меню', callback_data: 'menu:main' }]);
  return { inline_keyboard: rows };
}

function orderCard(order) {
  const receipt = order.npd_receipt_url ? '✅ <a href="' + esc(order.npd_receipt_url) + '">чек НПД</a>'
    : order.npd_receipt_status === 'error' ? '⚠️ ошибка чека: ' + esc(String(order.npd_receipt_error || '').slice(0, 80))
      : order.status === 'paid' ? '— не выпущен' : '—';
  return '📦 <b>Заказ №' + order.id + '</b>\n' +
    statusIcon(order.status) + ' Статус: <b>' + esc(order.status) + '</b>\n' +
    '📧 ' + esc(order.email || ('user ' + order.user_id)) + '\n' +
    (order.company_name ? '🏢 ' + esc(order.company_name) + '\nИНН ' + esc(order.company_inn || '—') + '\n' : '') +
    '📦 ' + esc(planName(order)) + ' · ' + (order.days || 0) + ' дн.\n' +
    '💰 <b>' + money(order.amount) + ' ₽</b>\n' +
    (order.invoice_number ? '🧾 Счёт ' + esc(order.invoice_number) + '\n' : '') +
    '🧾 Чек: ' + receipt + '\n' +
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
  const npdErr = db.prepare("SELECT COUNT(*) c FROM orders WHERE npd_receipt_status='error'").get().c;
  const bank = db.prepare("SELECT COUNT(*) c FROM bank_transactions WHERE status IN ('unmatched','error')").get().c;
  const reviews = db.prepare("SELECT COUNT(*) c FROM reviews WHERE status='pending'").get().c;
  const text = '📊 <b>Сводка CODE QR PRO</b>\n\n' +
    '👥 Пользователей: <b>' + totalUsers + '</b> · активных подписок: <b>' + paidUsers + '</b>\n' +
    '💰 Выручка всего: <b>' + money(revenue) + ' ₽</b> · за 30 дней: <b>' + money(revenue30) + ' ₽</b>\n' +
    '⏳ Ждут оплаты: <b>' + pending.c + '</b> на ' + money(pending.s) + ' ₽ · счетов юрлиц: ' + invoices + '\n' +
    '🎫 Обращений: <b>' + tickets + '</b> · отзывов на модерации: ' + reviews + '\n' +
    '⚠️ Ошибок заданий за 24ч: <b>' + jobsErr + '</b> · ошибок чеков НПД: ' + npdErr + '\n' +
    '🏦 Несопоставленных платежей: ' + bank + '\n' +
    '🕒 ' + new Date().toLocaleString('ru-RU');
  return send(chatId, text, { reply_markup: { inline_keyboard: [
    [{ text: '🔄 Обновить', callback_data: 'menu:stats' }, { text: '👥 Клиенты', callback_data: 'menu:users:0' }],
    [{ text: '💳 Ждут оплаты', callback_data: 'menu:orders:0' }, { text: '🖥 Система', callback_data: 'menu:system' }],
    [{ text: '⬅️ Главное меню', callback_data: 'menu:main' }]
  ] } });
}

async function showOrders(chatId, { onlyInvoices = false, page = 0 } = {}) {
  const per = 5;
  const offset = Math.max(0, Number(page) || 0) * per;
  const where = onlyInvoices ? "o.status='pending' AND o.payment_method='bank_transfer'" : "o.status='pending'";
  const total = db.prepare(`SELECT COUNT(*) c FROM orders o WHERE ${where}`).get().c;
  const rows = db.prepare(`SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(per, offset);
  const title = onlyInvoices ? '🧾 <b>Неоплаченные счета юрлиц</b>' : '💳 <b>Заказы, ожидающие оплаты</b>';
  if (!rows.length) {
    return send(chatId, title + '\n\n' + (onlyInvoices ? 'Неоплаченных счетов нет.' : 'Заказов, ожидающих оплаты, нет.'), {
      reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: onlyInvoices ? 'menu:invoices:0' : 'menu:orders:0' }], [{ text: '⬅️ Меню', callback_data: 'menu:main' }]] }
    });
  }
  await send(chatId, title + '\nВсего: <b>' + total + '</b>', { reply_markup: mainMenu() });
  for (const order of rows) await send(chatId, orderCard(order), { reply_markup: orderButtons(order) });
  const pages = Math.ceil(total / per);
  const nav = [];
  if (offset > 0) nav.push({ text: '⬅️', callback_data: (onlyInvoices ? 'menu:invoices:' : 'menu:orders:') + (Number(page) - 1) });
  nav.push({ text: 'Меню', callback_data: 'menu:main' });
  if (offset + rows.length < total) nav.push({ text: '➡️', callback_data: (onlyInvoices ? 'menu:invoices:' : 'menu:orders:') + (Number(page) + 1) });
  if (nav.length) await send(chatId, 'Страница ' + (Number(page) + 1) + ' из ' + Math.max(1, pages), { reply_markup: { inline_keyboard: [nav] } });
}

async function showOrder(chatId, id) {
  const order = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(id));
  if (!order) return send(chatId, 'Заказ №' + id + ' не найден.', { reply_markup: menuBack() });
  return send(chatId, orderCard(order), { reply_markup: orderButtons(order) });
}

async function sendInvoiceDocument(chatId, orderId) {
  const order = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(orderId));
  if (!order || order.buyer_type !== 'legal') throw new Error('Это не счёт юрлица');
  const pdf = await generateInvoicePdf({ ...order, buyer_email: order.email || '' });
  await send(chatId, '🧾 Счёт № ' + esc(order.invoice_number || order.id) + ' · ' + money(order.amount) + ' ₽\n' + esc(order.company_name || ''), { reply_markup: menuBack() });
  await tgSendDocument(chatId, pdf, 'invoice-' + order.id + '.pdf', 'Счёт № ' + (order.invoice_number || order.id));
}

async function showUsers(chatId, page = 0) {
  const per = 6;
  const offset = Math.max(0, Number(page) || 0) * per;
  const total = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const rows = db.prepare('SELECT id,email,name,plan,role,status,created_at FROM users ORDER BY id DESC LIMIT ? OFFSET ?').all(per, offset);
  const lines = rows.map((u) => statusIcon(u.status === 'blocked' ? 'canceled' : 'paid') + ' #' + u.id + ' · ' + esc(u.email) + '\n   ' + String(u.plan || 'free').toUpperCase() + ' · ' + (u.role === 'admin' ? 'админ' : u.status === 'blocked' ? 'заблокирован' : 'активен'));
  const keyboard = rows.map((u) => [{ text: '👤 ' + String(u.email).slice(0, 38) + (u.status === 'blocked' ? ' 🚫' : ''), callback_data: 'user:view:' + u.id }]);
  const nav = [];
  if (offset > 0) nav.push({ text: '⬅️', callback_data: 'menu:users:' + (Number(page) - 1) });
  nav.push({ text: 'Меню', callback_data: 'menu:main' });
  if (offset + rows.length < total) nav.push({ text: '➡️', callback_data: 'menu:users:' + (Number(page) + 1) });
  if (nav.length) keyboard.push(nav);
  return send(chatId, '👥 <b>Клиенты</b> · всего ' + total + '\nСтраница ' + (Number(page) + 1) + '\n\n' + lines.join('\n\n') + '\n\nПоиск: /find &lt;email или ID&gt;', { reply_markup: { inline_keyboard: keyboard } });
}

function userCard(user) {
  const sub = db.prepare("SELECT plan, expires_at, auto_renew FROM subscriptions WHERE user_id=? AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1").get(user.id);
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) c FROM orders WHERE user_id=? AND status='paid'").get(user.id).c;
  const jobs = db.prepare('SELECT COUNT(*) c FROM generation_jobs WHERE user_id=?').get(user.id).c;
  const usage = db.prepare('SELECT ops_used, checks_used, exports_used, api_calls_used FROM usage_periods WHERE user_id=? ORDER BY id DESC LIMIT 1').get(user.id) || {};
  return '👤 <b>' + esc(user.name || 'Без имени') + '</b>\n' +
    '📧 ' + esc(user.email) + '\n' +
    '🆔 ' + user.id + ' · роль <b>' + esc(user.role) + '</b> · статус <b>' + esc(user.status || 'active') + '</b>\n' +
    '📦 Тариф: <b>' + esc(String(user.plan || '').toUpperCase()) + '</b>' + (sub ? ' до ' + dt(sub.expires_at) : '') + '\n' +
    '💰 Оплачено всего: ' + money(paid) + ' ₽ · заданий: ' + jobs + '\n' +
    '📈 Использовано: операции ' + (usage.ops_used || 0) + ' · проверки ' + (usage.checks_used || 0) + ' · экспорт ' + (usage.exports_used || 0) + ' · API ' + (usage.api_calls_used || 0) + '\n' +
    (user.trial_used ? '🧪 Триал использован\n' : '') +
    '🕒 Регистрация: ' + dt(user.created_at) + '\n' +
    '🕒 Последний вход: ' + dt(user.last_login_at);
}

function userButtons(user) {
  const rows = [];
  if (user.role !== 'admin') {
    rows.push([user.status === 'blocked'
      ? { text: '✅ Разблокировать', callback_data: 'user:unblock:' + user.id }
      : { text: '🚫 Заблокировать', callback_data: 'user:blockask:' + user.id }]);
    rows.push([{ text: '⏱ Продлить +30 дней', callback_data: 'user:extendask:' + user.id }, { text: '🧪 Триал', callback_data: 'user:trial:' + user.id }]);
    rows.push([{ text: '📦 Сменить тариф', callback_data: 'user:planask:' + user.id }]);
    rows.push([{ text: '🔐 Сбросить 2FA', callback_data: 'user:reset2faask:' + user.id }, { text: '📈 Сбросить лимиты', callback_data: 'user:resetusageask:' + user.id }]);
    if (user.email_opt_out !== undefined) rows.push([{ text: user.email_opt_out ? '📬 Включить письма' : '📭 Отключить письма', callback_data: 'user:mail:' + user.id }]);
  }
  rows.push([{ text: '🌐 Карточка в админке', url: ADMIN_PANEL + '/users/' + user.id }, { text: '⬅️ Меню', callback_data: 'menu:main' }]);
  return { inline_keyboard: rows };
}

async function showUser(chatId, query) {
  const q = String(query || '').trim();
  if (!q) return showUsers(chatId);
  const user = /^\d+$/.test(q)
    ? db.prepare('SELECT * FROM users WHERE id=?').get(Number(q))
    : db.prepare("SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 1").get('%' + q + '%', '%' + q + '%');
  if (!user) return send(chatId, 'Клиент не найден: ' + esc(q), { reply_markup: menuBack() });
  return send(chatId, userCard(user), { reply_markup: userButtons(user) });
}

async function find(chatId, query) {
  const q = String(query || '').trim();
  if (!q) return send(chatId, 'Использование: /find email, ID или номер заказа', { reply_markup: menuBack() });
  const users = /^\d+$/.test(q)
    ? db.prepare('SELECT id,email,plan,status FROM users WHERE id=?').all(Number(q))
    : db.prepare('SELECT id,email,plan,status FROM users WHERE email LIKE ? LIMIT 5').all('%' + q + '%');
  const orders = /^\d+$/.test(q) ? db.prepare('SELECT id,status,amount,plan FROM orders WHERE id=?').all(Number(q)) : [];
  if (!users.length && !orders.length) return send(chatId, 'Ничего не найдено: ' + esc(q), { reply_markup: menuBack() });
  const lines = [];
  if (users.length) lines.push('👥 ' + users.map((u) => '#' + u.id + ' · ' + u.email + ' · ' + String(u.plan).toUpperCase()).join('\n'));
  if (orders.length) lines.push('📦 ' + orders.map((o) => '#' + o.id + ' · ' + o.status + ' · ' + money(o.amount) + ' ₽').join('\n'));
  const buttons = [
    ...users.map((u) => [{ text: '👤 ' + u.email, callback_data: 'user:view:' + u.id }]),
    ...orders.map((o) => [{ text: '📦 Заказ #' + o.id, callback_data: 'ord:view:' + o.id }]),
    [{ text: '⬅️ Меню', callback_data: 'menu:main' }]
  ];
  return send(chatId, '🔎 Результаты поиска\n\n' + lines.join('\n\n'), { reply_markup: { inline_keyboard: buttons } });
}

async function blockUser(chatId, id, blocked) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
  if (!user) return send(chatId, 'Клиент не найден.', { reply_markup: menuBack() });
  if (user.role === 'admin') return send(chatId, 'Администратора блокировать нельзя.', { reply_markup: menuBack() });
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
  return send(chatId, (blocked ? '🚫 Заблокирован: ' : '✅ Разблокирован: ') + esc(user.email), {
    reply_markup: userButtons(db.prepare('SELECT * FROM users WHERE id=?').get(user.id))
  });
}

async function userAction(chatId, id, action) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
  if (!user) return send(chatId, 'Клиент не найден.', { reply_markup: menuBack() });
  if (action === 'extend') {
    const r = extendSubscription({ userId: user.id, days: 30 });
    logEvent({ level: 'info', source: 'telegram', event: 'user.extend', message: user.email, meta: { userId: user.id } });
    return send(chatId, '⏱ Подписка продлена на 30 дней до ' + dt(r.expiresAt), { reply_markup: userButtons(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
  }
  if (action === 'trial') {
    try {
      startTrial(user);
      return send(chatId, '🧪 Пробный период выдан: ' + esc(user.email), { reply_markup: userButtons(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
    } catch (e) {
      return send(chatId, '⚠️ ' + esc(e.message), { reply_markup: userButtons(user) });
    }
  }
  if (action === 'reset2fa') {
    db.prepare("UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup='[]' WHERE id=?").run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    notifyStatusChange(user, 'Двухфакторная аутентификация сброшена администратором');
    return send(chatId, '🔐 2FA сброшена, сессии завершены: ' + esc(user.email), { reply_markup: userButtons(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
  }
  if (action === 'resetusage') {
    db.prepare('UPDATE usage_periods SET ops_used=0, checks_used=0, exports_used=0, api_calls_used=0 WHERE user_id=?').run(user.id);
    return send(chatId, '📈 Лимиты обнулены: ' + esc(user.email), { reply_markup: userButtons(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
  }
  if (action === 'mail') {
    db.prepare('UPDATE users SET email_opt_out=? WHERE id=?').run(user.email_opt_out ? 0 : 1, user.id);
    return send(chatId, (user.email_opt_out ? '📬 Письма включены: ' : '📭 Письма отключены: ') + esc(user.email), { reply_markup: userButtons(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
  }
  return send(chatId, 'Неизвестное действие.', { reply_markup: menuBack() });
}

async function setPlan(chatId, id, planId) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
  if (!user) return send(chatId, 'Клиент не найден.', { reply_markup: menuBack() });
  try {
    adminAssign({ userId: user.id, planId, days: 30, kind: 'paid' });
    logEvent({ level: 'info', source: 'telegram', event: 'user.plan', message: user.email + ' -> ' + planId, meta: { userId: user.id } });
    return send(chatId, '📦 Тариф ' + planId.toUpperCase() + ' назначен на 30 дней: ' + esc(user.email), { reply_markup: userButtons(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
  } catch (e) {
    return send(chatId, '⚠️ ' + esc(e.message), { reply_markup: userButtons(user) });
  }
}

async function showTickets(chatId) {
  const rows = db.prepare(`SELECT t.*, u.email, u.name FROM support_tickets t JOIN users u ON u.id=t.user_id
    WHERE t.status IN ('open','in_progress') ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.id DESC LIMIT 6`).all();
  if (!rows.length) return send(chatId, '🎫 Открытых обращений нет.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'menu:tickets' }, { text: '⬅️ Меню', callback_data: 'menu:main' }]] } });
  await send(chatId, '🎫 <b>Обращения в поддержку</b> · ' + rows.length, { reply_markup: mainMenu() });
  for (const t of rows) {
    const text = '🎫 <b>Обращение #' + t.id + '</b> · ' + esc(t.status) + '\n' +
      '👤 ' + esc(t.name || '—') + ' · ' + esc(t.email) + '\n' +
      '📝 ' + esc(t.subject || '—') + '\n' +
      '💬 ' + esc(String(t.message || '').slice(0, 500)) + '\n🕒 ' + dt(t.created_at);
    const buttons = { inline_keyboard: [
      [{ text: '🛠 В работу', callback_data: 'ticket:progress:' + t.id }, { text: '✅ Закрыть', callback_data: 'ticket:close:' + t.id }],
      [{ text: '🌐 Открыть в админке', url: ADMIN_PANEL + '/support' }, { text: '⬅️ Меню', callback_data: 'menu:main' }]
    ] };
    await send(chatId, text, { reply_markup: buttons });
  }
}

async function setTicketStatus(chatId, id, status) {
  const t = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(Number(id));
  if (!t) return send(chatId, 'Обращение не найдено.', { reply_markup: menuBack() });
  db.prepare("UPDATE support_tickets SET status=?, updated_at=datetime('now') WHERE id=?").run(status, t.id);
  logEvent({ level: 'info', source: 'telegram', event: 'ticket.status', message: 'ticket #' + t.id + ' -> ' + status, meta: { ticketId: t.id } });
  return send(chatId, (status === 'closed' ? '✅ Обращение #' + t.id + ' закрыто' : '🛠 Обращение #' + t.id + ' в работе'), { reply_markup: mainMenu() });
}

async function showJobs(chatId) {
  const stats = db.prepare('SELECT status, COUNT(*) c FROM generation_jobs GROUP BY status').all();
  const errors = db.prepare("SELECT j.id, j.user_id, j.status, j.error, j.created_at, u.email FROM generation_jobs j LEFT JOIN users u ON u.id=j.user_id WHERE j.status='error' ORDER BY j.id DESC LIMIT 6").all();
  const text = '⚠️ <b>Задания</b>\n\n' + stats.map((s) => esc(s.status) + ': <b>' + s.c + '</b>').join('\n') +
    '\n\nПоследние ошибки:\n' + (errors.length ? errors.map((e) => '#' + e.id + ' · ' + esc(e.email || e.user_id) + ' · ' + dt(e.created_at) + '\n' + esc(String(e.error || '').slice(0, 180))).join('\n\n') : 'нет');
  return send(chatId, text, { reply_markup: { inline_keyboard: [
    [{ text: '🔄 Обновить', callback_data: 'menu:jobs' }, { text: '🌐 Задания в админке', url: ADMIN_PANEL + '/jobs' }],
    [{ text: '⬅️ Меню', callback_data: 'menu:main' }]
  ] } });
}

async function showSystem(chatId) {
  const mem = process.memoryUsage();
  const dbDir = '/opt/code-qr/server/data';
  const sizeOf = (p) => { try { return statSync(p).size; } catch { return 0; } };
  let disk = null;
  try { const s = statfsSync('/'); disk = { free: Number(s.bfree) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }; } catch { /* ignore */ }
  let backup = null;
  try {
    const items = readdirSync(BACKUP_DIR).filter((n) => /^app-.*\.db\.enc$/.test(n))
      .map((n) => ({ n, t: statSync(BACKUP_DIR + '/' + n).mtime.toISOString() }))
      .sort((a, b) => String(b.t).localeCompare(String(a.t)));
    if (items[0]) backup = { name: items[0].n, at: items[0].t, ageHours: Math.round((Date.now() - new Date(items[0].t).getTime()) / 3600000) };
  } catch { /* ignore */ }
  const counts = {
    pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
    queue: db.prepare("SELECT COUNT(*) c FROM generation_jobs WHERE status='queued'").get().c,
    errors: db.prepare("SELECT COUNT(*) c FROM generation_jobs WHERE status='error'").get().c,
    tickets: db.prepare("SELECT COUNT(*) c FROM support_tickets WHERE status IN ('open','in_progress')").get().c
  };
  const npd = npdSettings();
  const integrations = [
    ['SMTP', smtpConfigured()], ['ЮKassa', providerConfigured()], ['Telegram', tgConfigured()],
    ['НПД', Boolean(npd.enabled && npd.configured)]
  ];
  const maintenance = getSetting('maintenance_mode', '0') === '1';
  const maintenanceUntil = String(getSetting('maintenance_until', '') || '');
  const text = '🖥 <b>Система CODE QR PRO</b>\n\n' +
    '⏱ Аптайм: <b>' + fmtUptime(process.uptime()) + '</b> · Node ' + esc(process.version) + '\n' +
    '🧠 RSS: ' + fmtBytes(mem.rss) + ' · диск свободно: ' + (disk ? fmtBytes(disk.free) : '—') + '\n' +
    '🗄 БД: ' + fmtBytes(sizeOf(dbDir + '/app.db')) + ' · WAL: ' + fmtBytes(sizeOf(dbDir + '/app.db-wal')) + '\n' +
    '📦 Очередь: ' + counts.queue + ' · ошибок: ' + counts.errors + ' · ждут оплаты: ' + counts.pending + ' · обращений: ' + counts.tickets + '\n' +
    '🔌 ' + integrations.map(([n, ok]) => n + ': ' + (ok ? '✅' : '❌')).join(' · ') + '\n' +
    '💾 Бэкап: ' + (backup ? esc(backup.name) + ' · ' + backup.ageHours + ' ч назад' : '❌ не найден') + '\n' +
    '🚧 Обслуживание: <b>' + (maintenance ? 'включено до ' + dt(maintenanceUntil) : 'выключено') + '</b>';
  return send(chatId, text, { reply_markup: { inline_keyboard: [
    [{ text: '🔄 Обновить', callback_data: 'menu:system' }, { text: maintenance ? '▶️ Выключить обслуживание' : '⏸ Включить обслуживание', callback_data: 'system:maintask' }],
    [{ text: '🌐 Система в админке', url: ADMIN_PANEL + '/system' }, { text: '⬅️ Меню', callback_data: 'menu:main' }]
  ] } });
}

async function issueReceiptAsk(chatId, id) {
  const order = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(id));
  if (!order) return send(chatId, 'Заказ не найден.', { reply_markup: menuBack() });
  if (order.status !== 'paid') return send(chatId, 'Чек можно выпустить только для оплаченного заказа.', { reply_markup: orderButtons(order) });
  return send(chatId, 'Выпустить чек НПД по заказу №' + order.id + ' на <b>' + money(order.amount) + ' ₽</b>?\n' + esc(order.email), {
    reply_markup: { inline_keyboard: [[{ text: '🧾 Да, выпустить', callback_data: 'ord:receipt:' + order.id }, { text: 'Отмена', callback_data: 'ord:view:' + order.id }]] }
  });
}

async function doIssueReceipt(chatId, id) {
  try {
    const r = await issueNpdReceiptForOrder(id, { force: true });
    const order = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(id));
    return send(chatId, '🧾 Чек НПД сформирован по заказу №' + id + '\n' + (order?.npd_receipt_url ? 'Ссылка на чек отправлена клиенту.' : ''), { reply_markup: order ? orderButtons(order) : menuBack() });
  } catch (e) {
    return send(chatId, '⚠️ Не удалось выпустить чек: ' + esc(e.message), { reply_markup: menuBack() });
  }
}

async function doResendReceipt(chatId, id) {
  try {
    await resendNpdReceipt(id);
    return send(chatId, '✉️ Чек НПД повторно отправлен на email клиента.', { reply_markup: menuBack() });
  } catch (e) {
    return send(chatId, '⚠️ Не удалось отправить чек: ' + esc(e.message), { reply_markup: menuBack() });
  }
}

async function toggleMaintenance(chatId) {
  const current = getSetting('maintenance_mode', '0') === '1';
  const next = !current;
  return send(chatId, next
    ? '⚠️ Включить режим обслуживания?\nКлиенты увидят страницу технических работ. Админка и вход останутся доступны.'
    : '▶️ Выключить режим обслуживания и вернуть сайт клиентам?', {
    reply_markup: { inline_keyboard: [[
      { text: next ? '⏸ Да, включить' : '▶️ Да, выключить', callback_data: 'system:maint:' + (next ? '1' : '0') },
      { text: 'Отмена', callback_data: 'menu:system' }
    ]] }
  });
}

async function applyMaintenance(chatId, enabled) {
  setSetting('maintenance_mode', enabled ? '1' : '0');
  setSetting('maintenance_until', enabled ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : '');
  logEvent({ level: 'warn', source: 'telegram', event: 'system.maintenance', message: 'maintenance=' + (enabled ? '1' : '0') });
  return send(chatId, enabled ? '⏸ Режим обслуживания включён.' : '▶️ Режим обслуживания выключен.', { reply_markup: menuBack() });
}

async function handleCommand(chatId, text) {
  const [cmdRaw, ...rest] = String(text || '').trim().split(/\s+/);
  const cmd = String(cmdRaw || '').split('@')[0].toLowerCase();
  const arg = rest.join(' ').trim();
  if (cmd === '/start' || cmd === '/menu') return back(chatId);
  if (cmd === '/help') return send(chatId, helpText(), { reply_markup: mainMenu() });
  if (cmd === '/stats') return showStats(chatId);
  if (cmd === '/orders') return showOrders(chatId);
  if (cmd === '/invoices') return showOrders(chatId, { onlyInvoices: true });
  if (cmd === '/order') return showOrder(chatId, arg);
  if (cmd === '/invoice') {
    try { return await sendInvoiceDocument(chatId, arg); }
    catch (e) { return send(chatId, '⚠️ Не удалось отправить счёт: ' + esc(e.message), { reply_markup: menuBack() }); }
  }
  if (cmd === '/users') return showUsers(chatId);
  if (cmd === '/user') return showUser(chatId, arg);
  if (cmd === '/find') return find(chatId, arg);
  if (cmd === '/tickets') return showTickets(chatId);
  if (cmd === '/jobs') return showJobs(chatId);
  if (cmd === '/system') return showSystem(chatId);
  if (cmd === '/receipt') return issueReceiptAsk(chatId, arg);
  if (cmd === '/id') return send(chatId, 'chat_id: <code>' + chatId + '</code>');
  return send(chatId, 'Не понял команду.\n\n' + helpText(), { reply_markup: mainMenu() });
}

async function handleCallback(chatId, cb, data) {
  const parts = String(data || '').split(':');
  const group = parts[0];
  const action = parts[1];
  const id = parts[2];
  const extra = parts.slice(3).join(':');

  if (group === 'menu') {
    if (action === 'main') return back(chatId);
    if (action === 'stats') return showStats(chatId);
    if (action === 'orders') return showOrders(chatId, { page: Number(id) || 0 });
    if (action === 'invoices') return showOrders(chatId, { onlyInvoices: true, page: Number(id) || 0 });
    if (action === 'users') return showUsers(chatId, Number(id) || 0);
    if (action === 'tickets') return showTickets(chatId);
    if (action === 'jobs') return showJobs(chatId);
    if (action === 'system') return showSystem(chatId);
  }
  if (group === 'ord') {
    if (action === 'view') return showOrder(chatId, id);
    if (action === 'doc') {
      try { return await sendInvoiceDocument(chatId, id); }
      catch (e) { return send(chatId, '⚠️ Не удалось отправить счёт: ' + esc(e.message), { reply_markup: menuBack() }); }
    }
    if (action === 'confirmask') {
      const preview = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(id));
      if (!preview) return send(chatId, 'Заказ не найден.', { reply_markup: menuBack() });
      return send(chatId, 'Подтвердить оплату заказа №' + id + ' на <b>' + money(preview.amount) + ' ₽</b>?\n' + esc(preview.email) + ' · ' + esc(planName(preview)) + ' · ' + esc(preview.status), {
        reply_markup: { inline_keyboard: [[{ text: '✅ Да, подтвердить', callback_data: 'ord:confirm:' + id }, { text: 'Отмена', callback_data: 'ord:view:' + id }]] }
      });
    }
    if (action === 'confirm') {
      try {
        const r = confirmOrderManually(id, 'telegram');
        return send(chatId, (r.already ? 'Заказ уже оплачен.' : '✅ Оплата подтверждена, тариф активирован.') + '\n\n' + orderCard(db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(Number(id))), { reply_markup: mainMenu() });
      } catch (e) { return send(chatId, '⚠️ ' + esc(e.message)); }
    }
    if (action === 'cancel') {
      try { cancelInvoiceOrderManually(id, 'telegram'); return send(chatId, '⛔ Счёт №' + id + ' отменён.', { reply_markup: mainMenu() }); }
      catch (e) { return send(chatId, '⚠️ ' + esc(e.message)); }
    }
    if (action === 'receiptask') return issueReceiptAsk(chatId, id);
    if (action === 'receipt') return doIssueReceipt(chatId, id);
    if (action === 'resend') return doResendReceipt(chatId, id);
  }
  if (group === 'user') {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
    if (!user) return send(chatId, 'Клиент не найден.', { reply_markup: menuBack() });
    if (action === 'view') return send(chatId, userCard(user), { reply_markup: userButtons(user) });
    if (action === 'blockask') return send(chatId, 'Заблокировать ' + esc(user.email) + '?\nСессии будут завершены.', { reply_markup: { inline_keyboard: [[{ text: '🚫 Да, заблокировать', callback_data: 'user:block:' + user.id }, { text: 'Отмена', callback_data: 'user:view:' + user.id }]] } });
    if (action === 'unblock') return blockUser(chatId, id, false);
    if (action === 'block') return blockUser(chatId, id, true);
    if (action === 'extendask') return send(chatId, 'Продлить подписку ' + esc(user.email) + ' на 30 дней?', { reply_markup: { inline_keyboard: [[{ text: '⏱ Да, продлить', callback_data: 'user:extend:' + user.id }, { text: 'Отмена', callback_data: 'user:view:' + user.id }]] } });
    if (action === 'extend') return userAction(chatId, id, 'extend');
    if (action === 'trial') return userAction(chatId, id, 'trial');
    if (action === 'reset2faask') return send(chatId, 'Сбросить 2FA и завершить все сессии у ' + esc(user.email) + '?', { reply_markup: { inline_keyboard: [[{ text: '🔐 Да, сбросить', callback_data: 'user:reset2fa:' + user.id }, { text: 'Отмена', callback_data: 'user:view:' + user.id }]] } });
    if (action === 'reset2fa') return userAction(chatId, id, 'reset2fa');
    if (action === 'resetusageask') return send(chatId, 'Обнулить счётчики лимитов у ' + esc(user.email) + '?', { reply_markup: { inline_keyboard: [[{ text: '📈 Да, обнулить', callback_data: 'user:resetusage:' + user.id }, { text: 'Отмена', callback_data: 'user:view:' + user.id }]] } });
    if (action === 'resetusage') return userAction(chatId, id, 'resetusage');
    if (action === 'mail') return userAction(chatId, id, 'mail');
    if (action === 'planask') return send(chatId, 'Новый тариф для ' + esc(user.email) + ' на 30 дней:', { reply_markup: { inline_keyboard: [
      [{ text: 'PRO', callback_data: 'user:plan:' + user.id + ':pro' }, { text: 'BUSINESS', callback_data: 'user:plan:' + user.id + ':business' }],
      [{ text: 'ENTERPRISE', callback_data: 'user:plan:' + user.id + ':enterprise' }, { text: 'Отмена', callback_data: 'user:view:' + user.id }]
    ] } });
    if (action === 'plan') return setPlan(chatId, id, extra);
  }
  if (group === 'ticket') {
    if (action === 'view') return showTickets(chatId);
    if (action === 'progress') return setTicketStatus(chatId, id, 'in_progress');
    if (action === 'close') return setTicketStatus(chatId, id, 'closed');
  }
  if (group === 'system') {
    if (action === 'maintask') return toggleMaintenance(chatId);
    if (action === 'maint') return applyMaintenance(chatId, id === '1');
  }
  return send(chatId, 'Действие устарело. Откройте меню заново.', { reply_markup: menuBack() });
}

export async function handleTelegramUpdate(update) {
  if (!update) return;
  try {
    if (update.message?.chat?.id) {
      const chatId = String(update.message.chat.id);
      // Привязка чата склада к аккаунту CODE QR PRO (одноразовый токен из раздела «Маркетплейсы»).
      const linkMatch = String(update.message.text || '').match(/^\/start\s+mp_([A-Za-z0-9]+)/);
      if (linkMatch) {
        const title = update.message.chat?.title || update.message.from?.first_name || 'личный чат';
        const res = consumeMarketplaceTgToken(linkMatch[1], chatId, title);
        if (res.ok) {
          await send(chatId, '✅ Чат «' + esc(title) + '» привязан к аккаунту CODE QR PRO.\nТеперь пик-листы на сборку коробов можно отправлять сюда из раздела «Маркетплейсы» → «Коробки».');
        } else {
          await send(chatId, '⛔ Ссылка привязки устарела или уже использована. Сформируйте новую в разделе «Маркетплейсы» → «Коробки» → «В Telegram-чат склада».');
        }
        return;
      }
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
      try { await tgAnswerCallback(cb.id, ''); }
      catch (e) {
        if (/query is too old|response timeout expired|query ID is invalid/i.test(String(e?.message || e))) return;
        throw e;
      }
      await handleCallback(chatId, cb, String(cb.data || ''));
    }
  } catch (e) {
    const message = String(e?.message || e);
    if (/query is too old|response timeout expired|query ID is invalid/i.test(message)) return;
    console.error('telegram bot update failed:', message);
    logEvent({ level: 'warn', source: 'telegram', event: 'bot_update_failed', message: message.slice(0, 300) });
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
      const updates = await tgGetUpdates(offset, 0);
      for (const update of updates) {
        offset = Number(update.update_id) + 1;
        setSetting('telegram_offset', String(offset));
        handleTelegramUpdate(update).catch((e) => console.error('telegram handler:', String(e?.message || e)));
      }
    } catch (e) {
      const msg = String(e?.message || e);
      if (/409|webhook/i.test(msg)) { log('polling conflict, deleting webhook'); await tgDeleteWebhook(); }
      else console.error('telegram getUpdates:', msg.slice(0, 200));
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      if (polling) setTimeout(loop, 1200);
    }
  };
  (async () => {
    try { botMe = await tgGetMe(); } catch { /* ignore */ }
    try { await tgDeleteWebhook(); } catch { /* ignore */ }
    try {
      await tgSetMyCommands([
        { command: 'menu', description: '👑 Главное меню' },
        { command: 'stats', description: '📊 Сводка сервиса' },
        { command: 'users', description: '👥 Клиенты' },
        { command: 'orders', description: '💳 Ждут оплаты' },
        { command: 'invoices', description: '🧾 Счета юрлиц' },
        { command: 'tickets', description: '🎫 Обращения' },
        { command: 'jobs', description: '⚠️ Задания и ошибки' },
        { command: 'system', description: '🖥 Система и бэкапы' },
        { command: 'find', description: '🔎 Поиск клиента/заказа' },
        { command: 'help', description: '❓ Помощь' }
      ]);
    } catch (e) { log('setMyCommands failed: ' + String(e?.message || e).slice(0, 120)); }
    log('premium admin bot polling started');
    loop();
  })();
}

export function stopTelegramBot() {
  polling = false;
}
