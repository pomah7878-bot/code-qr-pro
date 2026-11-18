import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { PLANS } from './plans.js';

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

export function activatePremium(userId, provider, externalId, orderId) {
  db.transaction(() => {
    const active = db.prepare("SELECT * FROM subscriptions WHERE user_id=? AND plan='premium' AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1").get(userId);
    const base = active ? new Date(active.expires_at.replace(' ', 'T') + 'Z').getTime() : Date.now();
    const expires = sqlNow(new Date(Math.max(base, Date.now()) + 30 * 86400000));
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

export async function createCheckout(user) {
  if (!providerConfigured()) {
    const e = new Error('Платёжный провайдер не настроен. Обратитесь к администратору.');
    e.statusCode = 503;
    throw e;
  }
  const amount = PLANS.premium.priceMonthly;
  const info = db.prepare("INSERT INTO orders (user_id, plan, amount) VALUES (?, 'premium', ?)").run(user.id, amount);
  const orderId = info.lastInsertRowid;
  const description = 'PREMIUM подписка CODE QR PRO (30 дней)';
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
    activatePremium(order.user_id, 'yookassa', data.id, order.id);
  } else if (data.status === 'canceled') {
    db.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(order.id);
  }
  return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
}

export function expireSubscriptions() {
  db.prepare("UPDATE subscriptions SET status='expired' WHERE status='active' AND expires_at <= datetime('now')").run();
  db.prepare("UPDATE users SET plan='free' WHERE plan='premium' AND id NOT IN (SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > datetime('now'))").run();
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
