import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { PLANS, getPremiumOffers, getTestPrice, offerFinalPrice, archiveAddon } from './plans.js';
import { notifyPayment, notifyOrderCanceled, notifyStatusChange } from './notify.js';
import { validatePromo, redeemPromo } from './lib/promo.js';

const YK_API = 'https://api.yookassa.ru/v3';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru';
const SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const SECRET = process.env.YOOKASSA_SECRET_KEY || '';

export const providerConfigured = () => Boolean(SHOP_ID && SECRET);

async function yk(method, path, body) {
  const res = await fetch(YK_API + path, {
    method,
    headers: {
      'Authorization': 'Basic ' + Buffer.from(SHOP_ID + ':' + SECRET).toString('base64'),
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

export function activatePremium(userId, provider, externalId, orderId, days = 30) {
  const termDays = Number.isFinite(days) && days > 0 ? days : 30;
  db.transaction(() => {
    const active = db.prepare("SELECT * FROM subscriptions WHERE user_id=? AND plan='premium' AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1").get(userId);
    const base = active ? new Date(active.expires_at.replace(' ', 'T') + 'Z').getTime() : Date.now();
    const expires = sqlNow(new Date(Math.max(base, Date.now()) + termDays * 86400000));
    if (active) {
      db.prepare('UPDATE subscriptions SET expires_at=? WHERE id=?').run(expires, active.id);
    } else {
      db.prepare("INSERT INTO subscriptions (user_id, plan, status, provider, external_id, started_at, expires_at) VALUES (?, 'premium', 'active', ?, ?, datetime('now'), ?)")
        .run(userId, provider, externalId, expires);
    }
    db.prepare("UPDATE users SET plan='premium' WHERE id=?").run(userId);
    if (orderId) db.prepare("UPDATE orders SET status='paid', paid_at=datetime('now') WHERE id=?").run(orderId);
  })();
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
    // продлеваем хранение уже существующих работ, если они ещё не удалены
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

export async function createCheckout(user, planId = 'premium', days = null, promoCode = '') {
  // валидация тарифа/периода ДО проверки провайдера
  let amount, termDays;
  if (planId === 'test') {
    amount = getTestPrice();
    termDays = 30;
  } else if (planId === 'archive') {
    const addon = archiveAddon();
    amount = addon.price;
    termDays = addon.days;
  } else if (planId === 'premium') {
    const offers = getPremiumOffers();
    const offer = days != null ? offers.find(o => o.days === Number(days)) : offers[0];
    if (!offer) {
      const e = new Error('Недоступный период подписки');
      e.statusCode = 400;
      throw e;
    }
    amount = offerFinalPrice(offer);
    termDays = offer.days;
  } else {
    const e = new Error('Неизвестный тариф');
    e.statusCode = 400;
    throw e;
  }
  if (!(amount > 0)) {
    const e = new Error('Некорректная цена тарифа');
    e.statusCode = 400;
    throw e;
  }

  let promo = null;
  if (promoCode) {
    const checked = validatePromo({ code: promoCode, userId: user.id, amount, days: termDays, plan: planId });
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
  const info = db.prepare('INSERT INTO orders (user_id, plan, amount, days, promo_code, discount) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, planId, amount, termDays, promo?.code || null, promo?.discount || 0);
  const orderId = info.lastInsertRowid;
  const description = planId === 'test'
    ? 'TEST: проверка оплаты CODE QR PRO (PREMIUM ' + termDays + ' дней)'
    : planId === 'archive'
      ? 'Архив CODE QR PRO: ' + termDays + ' дней, ' + archiveAddon().mb + ' МБ'
      : 'PREMIUM подписка CODE QR PRO (' + termDays + ' дней)';
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
      metadata: { order_id: String(orderId), product: 'code-qr-pro' }
    });
    db.prepare('UPDATE orders SET external_id=?, confirmation_url=? WHERE id=?')
      .run(data.id, data.confirmation?.confirmation_url || null, orderId);
  } catch (e) {
    db.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(orderId);
    throw e;
  }
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
}

export async function checkOrder(order) {
  if (order.status !== 'pending' || !order.external_id) return order;
  const data = await yk('GET', '/payments/' + order.external_id);
  if (data.status === 'succeeded') {
    if (order.plan === 'archive') {
      const addon = archiveAddon();
      activateArchive(order.user_id, 'yookassa', data.id, order.id, order.days || addon.days, addon.mb);
    } else {
      activatePremium(order.user_id, 'yookassa', data.id, order.id, order.days || 30);
    }
    const paid = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
    redeemPromo(paid);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
    notifyPayment(paid, u);
  } else if (data.status === 'canceled') {
    db.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(order.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
    notifyOrderCanceled(order, u);
  }
  return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
}

// Отмена ещё не оплаченного платежа в ЮKassa (best-effort для админки)
export async function getPayment(paymentId) {
  return yk('GET', '/payments/' + encodeURIComponent(paymentId));
}

export async function cancelPayment(paymentId) {
  return yk('POST', '/payments/' + encodeURIComponent(paymentId) + '/cancel', {});
}

// Возврат по успешному платежу. ЮKassa принимает payment_id и сумму.
export async function refundPayment(paymentId, amount) {
  return yk('POST', '/refunds', {
    payment_id: paymentId,
    amount: { value: Number(amount).toFixed(2), currency: 'RUB' }
  });
}

export function expireSubscriptions() {
  // кого переводим на FREE — для уведомления
  const expiring = db.prepare("SELECT id, email FROM users WHERE plan='premium' AND id NOT IN (SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > datetime('now'))").all();
  db.prepare("UPDATE subscriptions SET status='expired' WHERE status='active' AND expires_at <= datetime('now')").run();
  db.prepare("UPDATE users SET plan='free' WHERE plan='premium' AND id NOT IN (SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > datetime('now'))").run();
  for (const u of expiring) notifyStatusChange(u, 'Подписка PREMIUM истекла → FREE');
}

let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    expireSubscriptions();
    if (!providerConfigured()) return;
    const pending = db.prepare("SELECT * FROM orders WHERE status='pending' AND external_id IS NOT NULL AND created_at > datetime('now', '-1 day') ORDER BY id LIMIT 20").all();
    for (const o of pending) {
      try { await checkOrder(o); } catch { /* транзиентная ошибка YooKassa — повторим в следующем цикле */ }
    }
  } finally { sweeping = false; }
}

export function startBillingSweeper() {
  expireSubscriptions();
  setInterval(sweep, 30000).unref();
}
