import { randomUUID, createHash } from 'node:crypto';
import { db } from './db.js';
import { recordConversion } from './lib/analytics.js';
import { getPlan, normalizePlanId, getPremiumOffers, offerFinalPrice, archiveAddon, getTestPrice } from './plans.js';
import { activateSubscription, expireSubscriptionsAndTrials, remindTrialEnding, activeSubscription, currentPeriod } from './lib/subscription.js';
import { notifyPayment, notifyOrderCanceled, notifyStatusChange, notifyInvoiceCreated } from './notify.js';
import { issueNpdReceiptForOrder } from './lib/npd-receipt.js';
import { notifyClient } from './lib/client-mail.js';
import { validatePromo, redeemPromo } from './lib/promo.js';
import { invoiceSeller, validateBuyer } from './lib/invoice.js';

const YK_API = 'https://api.yookassa.ru/v3';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru';
const SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const SECRET = process.env.YOOKASSA_SECRET_KEY || '';

export const providerConfigured = () => Boolean(SHOP_ID && SECRET);

async function yk(method, path, body) {
  const res = await fetch(YK_API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(SHOP_ID + ':' + SECRET).toString('base64'),
      'Idempotence-Key': randomUUID(),
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.description || `YooKassa HTTP ${res.status}`);
  return data;
}

const sqlNow = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

/** Обратная совместимость для админки: активирует оплаченный период PRO. */
export function activatePremium(userId, provider, externalId, orderId, days = 30) {
  return activateSubscription({ userId, planId: 'pro', days, provider, externalId: externalId || '', orderId, source: provider || 'admin' });
}

export function activateArchive(userId, provider, externalId, orderId, days = 1095, mb = 10240) {
  const termDays = Number.isFinite(days) && days > 0 ? Math.round(days) : 1095;
  const termMb = Number.isFinite(mb) && mb > 0 ? Math.round(mb) : 10240;
  const row = db.prepare('SELECT archive_until, archive_mb FROM users WHERE id=?').get(userId);
  const now = Date.now();
  const base = row?.archive_until && new Date(row.archive_until.replace(' ', 'T') + 'Z').getTime() > now
    ? new Date(row.archive_until.replace(' ', 'T') + 'Z').getTime()
    : now;
  const until = sqlNow(new Date(base + termDays * 86400000));
  db.transaction(() => {
    db.prepare('UPDATE users SET archive_until=?, archive_mb=MAX(archive_mb, ?) WHERE id=?')
      .run(until, termMb, userId);
    db.prepare(
      "UPDATE generation_jobs SET expires_at=datetime('now','+' || ? || ' days') WHERE user_id=? AND (expires_at IS NULL OR expires_at < datetime('now','+' || ? || ' days'))"
    ).run(termDays, userId, termDays);
    db.prepare(
      "UPDATE activity_log SET expires_at=datetime('now','+' || ? || ' days') WHERE user_id=? AND (expires_at IS NULL OR expires_at < datetime('now','+' || ? || ' days'))"
    ).run(termDays, userId, termDays);
    if (orderId) db.prepare("UPDATE orders SET status='paid', paid_at=datetime('now') WHERE id=?").run(orderId);
  })();
  return { until, mb: termMb, provider, externalId };
}

const PLAN_PERIODS = { month: { days: 30, label: 'месяц' }, year: { days: 365, label: 'год' } };

/** Расчёт цены и срока для тарифа/периода. */
export function planOffer(planId, period = 'month') {
  const id = normalizePlanId(planId);
  if (id === 'archive') {
    const addon = archiveAddon();
    return { kind: 'archive', planId: 'archive', days: addon.days, price: addon.price, title: 'Архив на 3 года' };
  }
  const plan = getPlan(id);
  if (!plan || !plan.active || plan.id === 'free') {
    const e = new Error('Недоступный тариф');
    e.statusCode = 400;
    throw e;
  }
  const p = PLAN_PERIODS[period] || PLAN_PERIODS.month;
  const price = period === 'year'
    ? (Number(plan.priceYearly) > 0 ? Number(plan.priceYearly) : Math.round(Number(plan.priceMonthly) * 12))
    : Number(plan.priceMonthly);
  return { kind: 'subscription', planId: plan.id, plan, days: p.days, price, title: `${plan.title} на ${p.label}`, period: period === 'year' ? 'year' : 'month' };
}

export async function createCheckout(user, planId = 'pro', period = 'month', promoCode = '') {
  const offer = planOffer(planId, period);
  let amount = Number(offer.price);
  let termDays = offer.days;
  if (!(amount > 0)) {
    const e = new Error('Некорректная цена тарифа');
    e.statusCode = 400;
    throw e;
  }
  if (!(termDays > 0)) termDays = 30;

  let promo = null;
  if (promoCode) {
    const checked = validatePromo({ code: promoCode, userId: user.id, amount, days: termDays, plan: offer.planId });
    if (checked.error) {
      const e = new Error(checked.error);
      e.statusCode = 400;
      throw e;
    }
    promo = checked;
    amount = checked.finalAmount;
    termDays = checked.days;
  }

  if (!providerConfigured()) {
    const e = new Error('Платёжный провайдер не настроен. Обратитесь к администратору.');
    e.statusCode = 503;
    throw e;
  }
  const info = db.prepare(
    'INSERT INTO orders (user_id, plan, amount, days, promo_code, discount, kind, period, plan_title) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(user.id, offer.planId, amount, termDays, promo?.code || null, promo?.discount || 0, offer.kind, offer.period || 'month', offer.title);
  const orderId = info.lastInsertRowid;
  const description = offer.kind === 'archive'
    ? `Архив CODE QR PRO: ${termDays} дней, ${archiveAddon().mb} МБ`
    : `${offer.plan?.title || 'CODE QR PRO'} подписка CODE QR PRO (${termDays} дней)`;
  try {
    const data = await yk('POST', '/payments', {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: `${PUBLIC_URL}/app/billing?order=${orderId}` },
      description,
      receipt: {
        customer: { email: user.email },
        items: [{
          description: description.slice(0, 128),
          quantity: '1.00',
          amount: { value: amount.toFixed(2), currency: 'RUB' },
          vat_code: 1,
          payment_mode: 'full_prepayment',
          payment_subject: 'service'
        }]
      },
      metadata: { order_id: String(orderId), product: 'code-qr-pro', plan: offer.planId, kind: offer.kind }
    });
    db.prepare('UPDATE orders SET external_id=?, confirmation_url=? WHERE id=?')
      .run(data.id, data.confirmation?.confirmation_url || null, orderId);
  } catch (e) {
    db.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(orderId);
    throw e;
  }
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
}

/** B2B: заказ на оплату по счёту (банковский перевод), без ЮKassa. */
export function createInvoiceOrder(user, planId = 'pro', period = 'month', promoCode = '', buyerInput = {}) {
  const seller = invoiceSeller();
  if (!seller.ready) {
    const e = new Error('Оплата по счёту пока недоступна: администратор не заполнил банковские реквизиты продавца. Напишите в поддержку.');
    e.statusCode = 409;
    e.code = 'invoice_not_configured';
    throw e;
  }
  const check = validateBuyer(buyerInput);
  if (!check.ok) {
    const e = new Error(check.error);
    e.statusCode = 400;
    e.code = 'invalid_buyer';
    throw e;
  }
  const offer = planOffer(planId, period);
  let amount = Number(offer.price);
  let termDays = offer.days;
  if (!(amount > 0)) { const e = new Error('Некорректная цена тарифа'); e.statusCode = 400; throw e; }
  if (!(termDays > 0)) termDays = 30;
  let promo = null;
  if (promoCode) {
    const checked = validatePromo({ code: promoCode, userId: user.id, amount, days: termDays, plan: offer.planId });
    if (checked.error) { const e = new Error(checked.error); e.statusCode = 400; throw e; }
    promo = checked;
    amount = checked.finalAmount;
    termDays = checked.days;
  }
  const info = db.prepare(
    `INSERT INTO orders (user_id, plan, amount, days, promo_code, discount, kind, period, plan_title,
       buyer_type, company_name, company_inn, company_kpp, company_address, company_email,
       invoice_issued_at, payment_method, provider)
     VALUES (?,?,?,?,?,?,?,?,?, 'legal', ?,?,?,?,?, datetime('now'), 'bank_transfer', 'invoice')`
  ).run(
    user.id, offer.planId, amount, termDays, promo?.code || null, promo?.discount || 0,
    offer.kind, offer.period || 'month', offer.title,
    check.buyer.companyName, check.buyer.companyInn, check.buyer.companyKpp,
    check.buyer.companyAddress, check.buyer.companyEmail
  );
  const orderId = info.lastInsertRowid;
  const number = `СЧ-${new Date().getFullYear()}-${String(orderId).padStart(4, '0')}`;
  db.prepare('UPDATE orders SET invoice_number=? WHERE id=?').run(number, orderId);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  notifyStatusChange(user, `Сформирован счёт № ${number} на ${amount} ₽. Доступ активируется после поступления оплаты.`);
  notifyInvoiceCreated({ ...order, buyer_email: user.email }).catch(() => {});
  return order;
}

/** Подтверждение заказа по серверному платежу (только после GET /payments/:id). */
function fulfillOrder(order, payment) {
  if (!order || order.status === 'paid') return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  const amountMatches = Math.abs(Number(payment.amount?.value || 0) - Number(order.amount || 0)) < 0.01;
  if (!amountMatches) throw new Error('Сумма платежа не совпадает с заказом');
  if (order.kind === 'archive' || order.plan === 'archive') {
    const addon = archiveAddon();
    activateArchive(order.user_id, 'yookassa', payment.id, order.id, order.days || addon.days, addon.mb);
  } else {
    activateSubscription({
      userId: order.user_id,
      planId: order.plan,
      days: order.days || 30,
      provider: 'yookassa',
      externalId: payment.id,
      orderId: order.id,
      source: 'payment'
    });
  }
  db.prepare("INSERT OR IGNORE INTO payment_events (external_id, provider, order_id, status, payload_hash) VALUES (?,?,?,?,?)")
    .run(payment.id, 'yookassa', order.id, payment.status || 'succeeded', createHash('sha256').update(JSON.stringify(payment.metadata || {})).digest('hex').slice(0, 32));
  const paid = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  recordConversion('payment', paid.user_id, Number(paid.amount) || 0);
  redeemPromo(paid);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
  notifyPayment(paid, user);
  const sub = activeSubscription(order.user_id);
  notifyClient(user, 'premium_renewed', { until: sub?.expires_at ? String(sub.expires_at).slice(0, 10) : '' }).catch(() => {});
  // Чек НПД выпускается после подтверждённой оплаты, не блокируя ответ вебхука.
  issueNpdReceiptForOrder(paid.id).catch(() => {});
  return paid;
}

export async function checkOrder(order) {
  if (order.status !== 'pending' || !order.external_id) return order;
  const data = await yk('GET', '/payments/' + order.external_id);
  if (data.status === 'succeeded') {
    return fulfillOrder(order, data);
  }
  if (data.status === 'canceled') {
    db.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(order.id);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
    notifyOrderCanceled(order, user);
  }
  return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
}

/**
 * Обработка серверного уведомления ЮKassa.
 * Тело уведомления не доверяем: запрашиваем платёж по API и сверяем сумму/метаданные.
 * Повторная обработка защищена таблицей payment_events.
 */
export async function handleYooKassaNotification(body = {}) {
  const paymentId = String(body?.object?.id || '');
  if (!paymentId) return { ok: false, status: 400, error: 'Нет id платежа' };
  if (!providerConfigured()) return { ok: false, status: 503, error: 'Провайдер не настроен' };
  const seen = db.prepare('SELECT * FROM payment_events WHERE external_id=?').get(paymentId);
  if (seen) return { ok: true, duplicated: true, orderId: seen.order_id };
  const payment = await yk('GET', '/payments/' + encodeURIComponent(paymentId));
  if (payment.status !== 'succeeded') return { ok: true, ignored: true, status: payment.status };
  const orderId = Number(payment.metadata?.order_id || 0);
  const order = orderId
    ? db.prepare('SELECT * FROM orders WHERE id=?').get(orderId)
    : db.prepare('SELECT * FROM orders WHERE external_id=?').get(paymentId);
  if (!order) return { ok: true, ignored: true, reason: 'order_not_found' };
  const paid = fulfillOrder(order, payment);
  return { ok: true, duplicated: false, orderId: paid.id, status: paid.status };
}

export async function getPayment(paymentId) {
  return yk('GET', '/payments/' + encodeURIComponent(paymentId));
}

export async function cancelPayment(paymentId) {
  return yk('POST', '/payments/' + encodeURIComponent(paymentId) + '/cancel', {});
}

export async function refundPayment(paymentId, amount) {
  return yk('POST', '/refunds', {
    payment_id: paymentId,
    amount: { value: Number(amount).toFixed(2), currency: 'RUB' }
  });
}

// Устаревшие имена оставлены для совместимости: суперайзер теперь в subscription.js
export function expireSubscriptions() {
  return expireSubscriptionsAndTrials();
}

export function notifyExpiringSoon(days = 3) {
  return remindTrialEnding(days);
}

let sweeping = false;
let lastNotice = 0;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    expireSubscriptionsAndTrials();
    if (Date.now() - lastNotice > 6 * 3600_000) {
      lastNotice = Date.now();
      try { remindTrialEnding(); } catch { /* письма не должны ломать свипер */ }
    }
    if (!providerConfigured()) return;
    const pending = db.prepare("SELECT * FROM orders WHERE status='pending' AND external_id IS NOT NULL AND created_at > datetime('now', '-1 day') ORDER BY id LIMIT 20").all();
    for (const order of pending) {
      try { await checkOrder(order); } catch { /* транзиентная ошибка ЮKassa — повторим */ }
    }
  } finally { sweeping = false; }
}

export function startBillingSweeper() {
  expireSubscriptionsAndTrials();
  setTimeout(() => { try { remindTrialEnding(); } catch { /* ignore */ } }, 10 * 60_000).unref();
  setInterval(sweep, 30000).unref();
}
