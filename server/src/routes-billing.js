import { db } from './db.js';
import { requireAuth } from './routes.js';
import { createCheckout, checkOrder, providerConfigured } from './billing.js';
import { PURCHASABLE } from './plans.js';

export async function registerBillingRoutes(app) {
  app.post('/api/billing/checkout', { preHandler: requireAuth }, async (req, reply) => {
    const { plan, days } = req.body || {};
    if (!PURCHASABLE.includes(plan)) return reply.code(400).send({ error: 'Недоступный тариф' });
    try {
      const order = await createCheckout(req.user, plan, days ?? null);
      return { order: { id: order.id, amount: order.amount, status: order.status, confirmationUrl: order.confirmation_url } };
    } catch (e) {
      return reply.code(e.statusCode || 502).send({ error: String(e.message || e) });
    }
  });

  app.post('/api/billing/check', { preHandler: requireAuth }, async (req, reply) => {
    const { orderId } = req.body || {};
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(orderId, req.user.id);
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });
    try {
      const updated = await checkOrder(order);
      const sub = db.prepare("SELECT * FROM subscriptions WHERE user_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1").get(req.user.id);
      return { order: updated, subscription: sub || null };
    } catch (e) {
      return reply.code(502).send({ error: 'Не удалось проверить платёж: ' + String(e.message || e) });
    }
  });

  app.get('/api/billing/orders', { preHandler: requireAuth }, async (req) => ({
    orders: db.prepare('SELECT id,plan,amount,currency,status,provider,created_at,paid_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id)
  }));

  app.get('/api/billing/subscription', { preHandler: requireAuth }, async (req) => ({
    subscription: db.prepare("SELECT * FROM subscriptions WHERE user_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1").get(req.user.id) || null,
    providerConfigured: providerConfigured()
  }));
}
