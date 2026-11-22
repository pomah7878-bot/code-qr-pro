import { db } from './db.js';
import { activateArchive, checkOrder, providerConfigured, getPayment, cancelPayment, refundPayment } from './billing.js';
import { notifyPayment } from './notify.js';
import { recordConversion } from './lib/analytics.js';
import { activateSubscription } from './lib/subscription.js';
import { notifyStatusChange } from './notify.js';
import { requireAdmin, paging, sendCsv, like, dateOnly } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { redeemPromo } from './lib/promo.js';
import { issueNpdReceiptForOrder } from './lib/npd-receipt.js';

const STATUSES = ['pending', 'paid', 'canceled', 'refunded'];

function orderFilters(query) {
  const where = [];
  const params = [];
  const q = String(query?.q || '').trim().slice(0, 120);
  if (q) {
    const l = like(q);
    const parts = ["u.email LIKE ? ESCAPE '\\'"];
    params.push(l);
    if (/^\d{1,12}$/.test(q)) {
      parts.push('o.id = ?');
      params.push(Number(q));
    }
    where.push('(' + parts.join(' OR ') + ')');
  }
  const status = String(query?.status || '');
  if (STATUSES.includes(status)) {
    where.push('o.status = ?');
    params.push(status);
  }
  const from = dateOnly(query?.from);
  const to = dateOnly(query?.to);
  if (from) {
    where.push('date(o.created_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(o.created_at) <= date(?)');
    params.push(to);
  }
  return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id=?').get(id);
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);

function revokePremium(userId) {
  db.transaction(() => {
    db.prepare("UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'").run(userId);
    db.prepare("UPDATE users SET plan='free' WHERE id=?").run(userId);
  })();
}

export async function registerAdminOrderRoutes(app) {
  app.get('/api/admin/orders', { preHandler: requireAdmin }, async (req) => {
    const { page, per, offset } = paging(req.query);
    const { whereSql, params } = orderFilters(req.query);
    const orders = db.prepare(`
      SELECT o.id, o.plan, o.days, o.amount, o.discount, o.promo_code, o.status, o.provider,
             o.external_id, o.confirmation_url, o.created_at, o.paid_at, u.email, u.id AS user_id,
             o.buyer_type, o.company_name, o.company_inn, o.company_kpp, o.company_address, o.company_email,
             o.payment_method, o.invoice_number, o.invoice_issued_at,
             o.yk_invoice_url, o.yk_invoice_status, o.npd_receipt_url, o.npd_receipt_status, o.npd_receipt_error
      FROM orders o JOIN users u ON u.id=o.user_id
      ${whereSql}
      ORDER BY o.id DESC LIMIT ? OFFSET ?
    `).all(...params, per, offset);
    const total = db.prepare(`SELECT COUNT(*) c FROM orders o JOIN users u ON u.id=o.user_id ${whereSql}`).get(...params).c;
    const summary = db.prepare(`
      SELECT COUNT(*) c,
        COALESCE(SUM(CASE WHEN o.status='paid' THEN o.amount ELSE 0 END), 0) AS paid_sum,
        COALESCE(SUM(CASE WHEN o.status='pending' THEN o.amount ELSE 0 END), 0) AS pending_sum,
        COALESCE(SUM(CASE WHEN o.status='refunded' THEN o.amount ELSE 0 END), 0) AS refunded_sum
      FROM orders o JOIN users u ON u.id=o.user_id ${whereSql}
    `).get(...params);
    return { orders, total, page, per, pages: Math.max(1, Math.ceil(total / per)), summary };
  });

  app.get('/api/admin/orders/export.csv', { preHandler: requireAdmin }, async (req, reply) => {
    const { whereSql, params } = orderFilters(req.query);
    const rows = db.prepare(`
      SELECT o.id, u.email, o.plan, o.days, o.amount, o.discount, o.promo_code, o.status,
             o.provider, o.external_id, o.created_at, o.paid_at
      FROM orders o JOIN users u ON u.id=o.user_id
      ${whereSql} ORDER BY o.id DESC LIMIT 10000
    `).all(...params);
    return sendCsv(reply, 'code-qr-orders.csv',
      ['№', 'Email', 'Тариф', 'Дней', 'Сумма', 'Скидка', 'Промокод', 'Статус', 'Провайдер', 'Платёж', 'Создан', 'Оплачен'],
      rows.map((o) => [o.id, o.email, o.plan, o.days, o.amount, o.discount, o.promo_code || '', o.status,
        o.provider, o.external_id || '', o.created_at, o.paid_at || ''])
    );
  });

  // Ручное подтверждение оплаты: активирует PREMIUM на срок заказа
  app.post('/api/admin/orders/:id/confirm', { preHandler: requireAdmin }, async (req, reply) => {
    const order = getOrder(req.params.id);
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });
    if (order.status !== 'pending') {
      return reply.code(400).send({ error: 'Подтвердить можно только заказ в статусе «ожидает оплаты»' });
    }
    if (order.kind === 'archive' || order.plan === 'archive') {
      activateArchive(order.user_id, 'manual', null, order.id, order.days || 1095);
    } else {
      activateSubscription({
        userId: order.user_id,
        planId: order.plan,
        days: order.days || 30,
        provider: order.provider || 'manual',
        externalId: order.external_id || null,
        orderId: order.id,
        source: order.payment_method === 'bank_transfer' ? 'invoice' : 'admin'
      });
    }
    db.prepare("UPDATE orders SET status='paid', paid_at=datetime('now') WHERE id=?").run(order.id);
    redeemPromo(getOrder(order.id));
    const user = getUser(order.user_id);
    const paid = getOrder(order.id);
    recordConversion('payment', paid.user_id, Number(paid.amount) || 0);
    notifyPayment(paid, user);
    notifyStatusChange(user, `Заказ №${order.id} подтверждён вручную (${order.amount} ₽)`);
    issueNpdReceiptForOrder(paid.id, { force: true }).catch(() => {});
    audit(req, 'order.confirm', 'order', order.id, { amount: order.amount, days: order.days });
    return { ok: true, order: getOrder(order.id) };
  });

  // Отмена: у ЮKassa сначала пробуем отменить платёж
  app.post('/api/admin/orders/:id/cancel', { preHandler: requireAdmin }, async (req, reply) => {
    const order = getOrder(req.params.id);
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });
    if (order.status !== 'pending') {
      return reply.code(400).send({ error: 'Отменить можно только заказ в статусе «ожидает оплаты»' });
    }
    let warning = '';
    if (order.external_id && providerConfigured()) {
      try {
        const payment = await getPayment(order.external_id);
        if (payment.status === 'succeeded') {
          return reply.code(409).send({ error: 'Платёж уже оплачен — отмена невозможна. Оформите возврат или подтвердите заказ.' });
        }
        if (payment.status === 'waiting_for_capture') {
          await cancelPayment(order.external_id);
        } else if (payment.status === 'pending') {
          // ЮKassa разрешает API-отмену только для waiting_for_capture.
          // Платёж до оплаты отменить нельзя — отменяем заказ локально,
          // ссылка перестанет действовать после истечения срока платежа.
          warning = 'Платёж ещё не оплачен (pending). ЮKassa не отменяет такие платежи через API — заказ отменён локально, ссылка на оплату станет недействительной после истечения её срока.';
        }
      } catch (e) {
        warning = 'ЮKassa не подтвердила платёж (' + String(e?.message || e) + '). Заказ отменён локально; проверьте платёж в личном кабинете ЮKassa.';
      }
    }
    db.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(order.id);
    audit(req, 'order.cancel', 'order', order.id, { amount: order.amount });
    return { ok: true, warning, order: getOrder(order.id) };
  });

  // Возврат: только через ЮKassa, опционально снимаем доступ
  app.post('/api/admin/orders/:id/refund', { preHandler: requireAdmin }, async (req, reply) => {
    const order = getOrder(req.params.id);
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });
    if (order.status !== 'paid') {
      return reply.code(400).send({ error: 'Возврат возможен только по оплаченному заказу' });
    }
    if (!providerConfigured()) {
      return reply.code(503).send({ error: 'ЮKassa не настроена — возврат нужно оформить вручную в личном кабинете' });
    }
    if (!order.external_id) {
      return reply.code(400).send({ error: 'У заказа нет платежа в ЮKassa (оплата подтверждена вручную)' });
    }
    let refund;
    try {
      refund = await refundPayment(order.external_id, order.amount);
    } catch (e) {
      return reply.code(502).send({ error: 'ЮKassa не приняла возврат: ' + String(e?.message || e) });
    }
    if (refund.status !== 'succeeded') {
      return reply.code(202).send({ ok: true, pending: true, refund });
    }
    const revoke = req.body?.revoke !== false;
    db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(order.id);
    if (revoke) revokePremium(order.user_id);
    const user = getUser(order.user_id);
    notifyStatusChange(user, `Возврат по заказу №${order.id} (${order.amount} ₽)` + (revoke ? ', PREMIUM снят' : ''));
    audit(req, 'order.refund', 'order', order.id, { amount: order.amount, revoke, refundId: refund.id });
    return { ok: true, order: getOrder(order.id), refund };
  });

  // Повторная проверка статуса в ЮKassa
  app.post('/api/admin/orders/:id/recheck', { preHandler: requireAdmin }, async (req, reply) => {
    const order = getOrder(req.params.id);
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });
    if (order.status !== 'pending') {
      return reply.code(400).send({ error: 'Проверять можно только заказ в статусе «ожидает оплаты»' });
    }
    if (!providerConfigured()) {
      return reply.code(503).send({ error: 'ЮKassa не настроена' });
    }
    try {
      const updated = await checkOrder(order);
      return { ok: true, order: updated };
    } catch (e) {
      return reply.code(502).send({ error: 'ЮKassa недоступна: ' + String(e?.message || e) });
    }
  });
}
