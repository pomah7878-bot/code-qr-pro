import { db } from '../db.js';
import { activateArchive } from '../billing.js';
import { activateSubscription } from './subscription.js';
import { redeemPromo } from './promo.js';
import { notifyPayment, notifyOrderCanceled } from '../notify.js';
import { recordConversion } from './analytics.js';
import { logEvent } from './app-log.js';

/** Ручное подтверждение оплаты (банковский счёт или администратор). */
export function confirmOrderManually(orderId, source = 'admin') {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(orderId));
  if (!order) throw new Error('Заказ не найден');
  if (order.status === 'paid') return { order, already: true };
  if (order.status !== 'pending') throw new Error('Подтвердить можно только заказ в статусе «ожидает оплаты»');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
  if (!user) throw new Error('Пользователь не найден бота');
  if (order.kind === 'archive' || order.plan === 'archive') {
    activateArchive(order.user_id, source, order.external_id || null, order.id, order.days || 1095);
  } else {
    activateSubscription({
      userId: order.user_id,
      planId: order.plan,
      days: order.days || 30,
      provider: order.provider || source,
      externalId: order.external_id || null,
      orderId: order.id,
      source: order.payment_method === 'bank_transfer' ? 'invoice' : source
    });
  }
  db.prepare("UPDATE orders SET status='paid', paid_at=datetime('now') WHERE id=?").run(order.id);
  const paid = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  redeemPromo(paid);
  recordConversion('payment', paid.user_id, Number(paid.amount) || 0);
  notifyPayment(paid, user);
  logEvent({ level: 'info', source, event: 'order.confirm', message: `Заказ №${paid.id} подтверждён`, meta: { orderId: paid.id, amount: paid.amount, plan: paid.plan } });
  return { order: paid, already: false };
}

/** Отмена неоплаченного счёта (банковский перевод). Карточные платежи отменяются в админке. */
export function cancelInvoiceOrderManually(orderId, source = 'telegram') {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(orderId));
  if (!order) throw new Error('Заказ не найден');
  if (order.status !== 'pending') throw new Error('Отменить можно только неоплаченный заказ');
  if (order.payment_method !== 'bank_transfer' && order.provider !== 'invoice') {
    throw new Error('Этот заказ оплачивается картой — отмените его в админке (ЮKassa)');
  }
  db.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(order.id);
  const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
  notifyOrderCanceled(updated, user);
  logEvent({ level: 'info', source, event: 'order.cancel', message: `Заказ №${order.id} отменён`, meta: { orderId: order.id } });
  return updated;
}
