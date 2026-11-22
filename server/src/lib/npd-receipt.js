import NalogAPI from 'moy-nalog';
import { db } from '../db.js';
import { getSetting } from '../settings.js';
import { sendMail, smtpConfigured } from './mailer.js';
import { renderBrandEmail } from './email-template.js';
import { logEvent } from './app-log.js';

/**
 * Автоматический выпуск чеков НПД через неофициальный API «Мой налог».
 * Включается только после того, как администратор сохранил логин и пароль
 * в настройках. Если интеграция выключена, платежи работают как раньше.
 */

export function npdSettings() {
  const login = String(getSetting('npd_login', '') || '').trim();
  const password = String(getSetting('npd_password', '') || '');
  const serviceName = String(getSetting('npd_service_name', 'Услуги сервиса CODE QR PRO') || '').trim();
  return {
    enabled: getSetting('npd_enabled', '0') === '1',
    auto: getSetting('npd_auto', '1') !== '0',
    login,
    password,
    serviceName: serviceName.slice(0, 120) || 'Услуги сервиса CODE QR PRO',
    configured: Boolean(login && password)
  };
}

let cached = null;

function client(settings) {
  const key = settings.login + '|' + settings.password;
  if (cached?.key === key) return cached.client;
  const instance = new NalogAPI({ login: settings.login, password: settings.password, timeoutMs: 30000 });
  cached = { key, client: instance };
  return instance;
}

export async function testNpdConnection() {
  const s = npdSettings();
  if (!s.configured) throw new Error('Не заполнены логин и пароль «Мой налог»');
  const api = client(s);
  const info = await api.userInfo();
  return {
    ok: true,
    inn: String(info?.inn || info?.profile?.inn || s.login),
    name: String(info?.displayName || info?.profile?.displayName || info?.name || '').slice(0, 120)
  };
}

function receiptEmailBody(order, printUrl) {
  const amount = Number(order.amount || 0).toLocaleString('ru');
  const plan = String(order.plan_title || order.plan || 'Подписка').trim();
  const payload = {
    title: 'Чек об оплате',
    preheader: `Чек НПД по заказу №${order.id}`,
    badge: 'Чек НПД',
    intro: `Здравствуйте!\n\nОплата по заказу №${order.id} получена. Мы сформировали чек самозанятого (НПД) на сумму ${amount} ₽ за «${plan}».`,
    notice: 'Чек сформирован в сервисе «Мой налог». Ссылка ведёт на официальный чек ФНС.',
    ctaLabel: 'Открыть чек',
    ctaUrl: printUrl
  };
  const { html, text } = renderBrandEmail(payload);
  return { html, text, subject: `Чек по оплате CODE QR PRO · заказ №${order.id}` };
}

async function emailReceipt(order, printUrl) {
  if (!smtpConfigured()) return false;
  const user = db.prepare('SELECT email, name FROM users WHERE id=?').get(order.user_id);
  const to = order.buyer_type === 'legal' && order.company_email ? order.company_email : user?.email;
  if (!to) return false;
  const { html, text, subject } = receiptEmailBody(order, printUrl);
  await sendMail({ to, subject, text, html });
  db.prepare("UPDATE orders SET npd_receipt_status='sent', npd_receipt_email=?, npd_receipt_at=datetime('now') WHERE id=?")
    .run(to, order.id);
  return true;
}

/** Создаёт чек НПД для оплаченного заказа. Повторный вызов безопасен. */
export async function issueNpdReceiptForOrder(orderId, { force = false } = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(orderId));
  if (!order) throw new Error('Заказ не найден');
  if (order.status !== 'paid') throw new Error('Чек можно сформировать только для оплаченного заказа');
  if (order.npd_receipt_id && ['issued', 'sent'].includes(order.npd_receipt_status)) return { skipped: true, order };
  const s = npdSettings();
  if (!s.enabled || !s.configured) throw new Error('Выпуск чеков НПД не подключён в настройках');
  if (!s.auto && !force) return { skipped: true, autoDisabled: true, order };
  if (!(Number(order.amount) > 0)) throw new Error('Некорректная сумма заказа');

  const api = client(s);
  const name = `${s.serviceName} · заказ №${order.id}`.slice(0, 128);
  const user = db.prepare('SELECT name FROM users WHERE id=?').get(order.user_id);
  const isLegal = order.buyer_type === 'legal';
  if (isLegal && !String(order.company_inn || '').trim()) {
    db.prepare("UPDATE orders SET npd_receipt_status='error', npd_receipt_error='Для чека НПД от юрлица нужен ИНН покупателя' WHERE id=?").run(order.id);
    throw new Error('Для чека НПД от юрлица нужен ИНН покупателя');
  }
  const amount = Number(order.amount);
  let result;
  try {
    // Для безналичных оплат (карта, СБП, счёт) в чеке НПД указывается безналичный расчёт.
    result = await api.call('income', {
      paymentType: 'WIRE',
      ignoreMaxTotalIncomeRestriction: false,
      client: {
        contactPhone: null,
        displayName: isLegal ? String(order.company_name || '').slice(0, 120) : String(user?.name || '').slice(0, 120) || null,
        incomeType: isLegal ? 'FROM_LEGAL_ENTITY' : 'FROM_INDIVIDUAL',
        inn: isLegal ? String(order.company_inn || '') : null
      },
      requestTime: api.dateToLocalISO(),
      operationTime: api.dateToLocalISO(new Date()),
      services: [{ name, amount, quantity: 1 }],
      totalAmount: amount.toFixed(2)
    });
  } catch (e) {
    const message = String(e?.message || e).slice(0, 500);
    db.prepare("UPDATE orders SET npd_receipt_status='error', npd_receipt_error=? WHERE id=?").run(message, order.id);
    logEvent({ level: 'warn', source: 'npd', event: 'receipt_error', message: `Заказ №${order.id}: ${message.slice(0, 200)}`, meta: { orderId: order.id } });
    throw e;
  }
  if (!result?.approvedReceiptUuid) {
    const message = String(result?.message || result?.description || JSON.stringify(result || {}).slice(0, 300)).slice(0, 500);
    db.prepare("UPDATE orders SET npd_receipt_status='error', npd_receipt_error=? WHERE id=?").run(message, order.id);
    logEvent({ level: 'warn', source: 'npd', event: 'receipt_error', message: `Заказ №${order.id}: ${message.slice(0, 200)}`, meta: { orderId: order.id } });
    throw new Error(message);
  }

  const receiptId = String(result.approvedReceiptUuid).slice(0, 200);
  const printUrl = String(`${api.apiUrl}/receipt/${api.INN}/${receiptId}/print`).slice(0, 1000);
  db.prepare(`UPDATE orders SET npd_receipt_id=?, npd_receipt_url=?, npd_receipt_status='issued',
      npd_receipt_error='', npd_receipt_at=datetime('now') WHERE id=?`).run(receiptId, printUrl, order.id);
  const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  logEvent({ level: 'info', source: 'npd', event: 'receipt_created', message: `Чек НПД по заказу №${order.id}`, meta: { orderId: order.id, receiptId } });

  if (printUrl) {
    try { await emailReceipt(updated, printUrl); } catch (e) {
      db.prepare("UPDATE orders SET npd_receipt_status='issued', npd_receipt_error=? WHERE id=?").run(String(e?.message || e).slice(0, 500), order.id);
      logEvent({ level: 'warn', source: 'npd', event: 'receipt_email_failed', message: String(e?.message || e).slice(0, 200), meta: { orderId: order.id } });
    }
  }
  return { ok: true, order: db.prepare('SELECT * FROM orders WHERE id=?').get(order.id) };
}

/** Повторная отправка уже созданного чека на email. */
export async function resendNpdReceipt(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(orderId));
  if (!order?.npd_receipt_url) throw new Error('У заказа нет ссылки на чек');
  const sent = await emailReceipt(order, order.npd_receipt_url);
  if (!sent) throw new Error('SMTP не настроен или у клиента нет email');
  return { ok: true };
}
