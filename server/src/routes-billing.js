import { db } from './db.js';
import { requireAuth } from './routes.js';
import {
  createCheckout, createInvoiceOrder, createYooKassaInvoice, checkOrder, providerConfigured, handleYooKassaNotification, planOffer
} from './billing.js';
import { generateInvoicePdf, invoiceSeller, invoiceNumberFor } from './lib/invoice.js';
import { archiveAddon, getPremiumOffers, normalizePlanId, listPlans } from './plans.js';
import { entitlements, startTrial, setAutoRenew, cancelSubscription, trialInfo, SubscriptionError } from './lib/subscription.js';
import { validatePromo } from './lib/promo.js';
import { audit } from './lib/audit.js';
import { notifyInvoiceCreated } from './notify.js';

const fail = (reply, e) => reply.code(e.statusCode || 400).send({ error: String(e?.message || e), code: e.code || null });

export async function registerBillingRoutes(app) {
  // Публичный вебхук ЮKassa: подтверждение только по серверному запросу к API провайдера
  app.post('/api/billing/webhook/yookassa', async (req, reply) => {
    try {
      const result = await handleYooKassaNotification(req.body || {});
      if (!result.ok) return reply.code(result.status || 400).send({ ok: false });
      return { ok: true };
    } catch (e) {
      // ЮKassa повторяет уведомление при 5xx — это нормальный путь восстановления
      req.log?.warn?.({ err: String(e?.message || e) }, 'yookassa webhook failed');
      return reply.code(500).send({ ok: false });
    }
  });

  app.get('/api/billing/plans', async () => ({
    plans: listPlans({ activeOnly: true }),
    providerConfigured: providerConfigured()
  }));

  app.get('/api/billing/subscription', { preHandler: requireAuth }, async (req) => {
    const data = entitlements(req.user);
    return {
      plan: data.plan,
      usage: data.usage,
      subscription: data.usage.subscription,
      trial: trialInfo(req.user),
      providerConfigured: providerConfigured(),
      plans: listPlans({ activeOnly: true })
    };
  });

  app.post('/api/billing/trial', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const result = startTrial(req.user);
      audit(req, 'billing.trial_start', 'user', req.user.id, { days: result.days });
      return { ok: true, trial: result.trial, plan: result.plan };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/billing/checkout', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body || {};
    // совместимость со старым фронтом: plan='premium' + days=30/365
    let planId = normalizePlanId(body.planId || body.plan || 'pro');
    let period = body.period === 'year' ? 'year' : 'month';
    if (body.days != null && !body.period) period = Number(body.days) >= 300 ? 'year' : 'month';
    try {
      if (body.buyerType === 'legal' || body.invoice === true) {
        const order = createInvoiceOrder(req.user, planId, period, body.promoCode || '', body.buyer || body);
        let online = null;
        let onlineError = '';
        try {
          online = await createYooKassaInvoice(order.id);
        } catch (e) {
          onlineError = String(e?.message || e).slice(0, 300);
          req.log?.warn?.({ err: onlineError, orderId: order.id }, 'yookassa invoice create failed');
        }
        const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
        notifyInvoiceCreated({ ...fresh, buyer_email: req.user.email, online_pay_url: online?.url || '' }).catch(() => {});
        return {
          order: {
            id: fresh.id, amount: fresh.amount, status: fresh.status, plan: fresh.plan, period: fresh.period,
            buyerType: 'legal', paymentMethod: 'bank_transfer', invoiceNumber: fresh.invoice_number,
            invoiceUrl: '/api/billing/orders/' + fresh.id + '/invoice',
            onlinePayUrl: online?.url || '', onlinePayExpiresAt: online?.expiresAt || '', onlinePayError: onlineError
          }
        };
      }
      if (planId === 'archive') {
        const order = await createCheckout(req.user, 'archive', 'month', body.promoCode || '');
        return { order: { id: order.id, amount: order.amount, status: order.status, confirmationUrl: order.confirmation_url } };
      }
      const order = await createCheckout(req.user, planId, period, body.promoCode || '');
      return { order: { id: order.id, amount: order.amount, status: order.status, confirmationUrl: order.confirmation_url, plan: order.plan, period: order.period } };
    } catch (e) {
      return reply.code(e.statusCode || 502).send({ error: String(e.message || e) });
    }
  });

  // Смена/продление тарифа = новый платёж; старый период сохраняется до окончания,
  // новый тариф активируется сразу после подтверждения оплаты.
  app.post('/api/billing/change', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body || {};
    const planId = normalizePlanId(body.planId || body.plan);
    const period = body.period === 'year' ? 'year' : 'month';
    try {
      const order = await createCheckout(req.user, planId, period, body.promoCode || '');
      return { order: { id: order.id, amount: order.amount, status: order.status, confirmationUrl: order.confirmation_url } };
    } catch (e) {
      return reply.code(e.statusCode || 502).send({ error: String(e.message || e) });
    }
  });

  // Предварительная цена и промокод
  app.post('/api/billing/promo/check', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body || {};
    try {
      const planId = normalizePlanId(body.planId || body.plan || 'pro');
      const period = body.period === 'year' ? 'year' : 'month';
      const offer = planOffer(planId, period);
      if (!(offer.price > 0)) return reply.code(400).send({ error: 'Недоступный тариф' });
      if (!body.code) {
        return { ok: true, code: null, discount: 0, bonusDays: 0, finalAmount: offer.price, days: offer.days, planId: offer.planId };
      }
      const checked = validatePromo({ code: body.code, userId: req.user.id, amount: offer.price, days: offer.days, plan: offer.planId });
      if (checked.error) return reply.code(400).send({ error: checked.error });
      return {
        ok: true,
        code: checked.code,
        kind: checked.kind,
        discount: checked.discount,
        bonusDays: checked.bonusDays,
        finalAmount: checked.finalAmount,
        days: checked.days,
        planId: offer.planId
      };
    } catch (e) {
      return reply.code(e.statusCode || 400).send({ error: String(e.message || e) });
    }
  });

  app.post('/api/billing/check', { preHandler: requireAuth }, async (req, reply) => {
    const { orderId } = req.body || {};
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(orderId, req.user.id);
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });
    try {
      const updated = await checkOrder(order);
      const data = entitlements(req.user);
      return { order: updated, subscription: data.usage.subscription, plan: data.plan, usage: data.usage };
    } catch (e) {
      return reply.code(502).send({ error: 'Не удалось проверить платёж: ' + String(e.message || e) });
    }
  });

  app.get('/api/billing/orders', { preHandler: requireAuth }, async (req) => ({
    orders: db.prepare(
      `SELECT id,plan,plan_title,kind,period,amount,currency,status,provider,created_at,paid_at,days,
        buyer_type,company_name,company_inn,company_kpp,payment_method,invoice_number,invoice_issued_at,
        yk_invoice_url,yk_invoice_status,yk_invoice_expires_at,
        npd_receipt_url,npd_receipt_status,npd_receipt_error
       FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50`
    ).all(req.user.id)
  }));

  // Доступность оплаты по счёту для юрлиц.
  app.get('/api/billing/invoice-info', { preHandler: requireAuth }, async () => {
    const seller = invoiceSeller();
    return { available: seller.ready, missing: seller.ready ? [] : seller.missing };
  });

  // Счёт на оплату: владелец заказа или администратор.
  // Онлайн-ссылка на оплату B2B-счёта (создаётся заново, если истекла).
  app.post('/api/billing/orders/:id/pay-link', { preHandler: requireAuth }, async (req, reply) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order || order.user_id !== req.user.id) return reply.code(404).send({ error: 'Заказ не найден' });
    try {
      const online = await createYooKassaInvoice(order.id);
      const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
      return { ok: true, url: online.url, expiresAt: online.expiresAt, order: fresh };
    } catch (e) {
      return reply.code(502).send({ error: String(e?.message || e).slice(0, 300) });
    }
  });

  app.get('/api/billing/orders/:id/invoice', { preHandler: requireAuth }, async (req, reply) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order || order.buyer_type !== 'legal') return reply.code(404).send({ error: 'Счёт не найден' });
    if (order.user_id !== req.user.id && req.user.role !== 'admin') return reply.code(403).send({ error: 'Нет доступа' });
    const buyer = db.prepare('SELECT email FROM users WHERE id=?').get(order.user_id);
    try {
      const pdf = await generateInvoicePdf({ ...order, buyer_email: buyer?.email || '' });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="invoice-${order.id}.pdf"`);
      return reply.send(pdf);
    } catch (e) {
      req.log.error(e, 'invoice pdf');
      return reply.code(500).send({ error: 'Не удалось сформировать счёт' });
    }
  });

  app.post('/api/billing/auto-renew', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const result = setAutoRenew(req.user.id, Boolean(req.body?.enabled));
      audit(req, 'billing.auto_renew', 'user', req.user.id, { enabled: Boolean(req.body?.enabled) });
      return { ok: true, ...result };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/billing/cancel', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const immediate = Boolean(req.body?.immediate);
      const result = cancelSubscription(req.user.id, { immediate });
      audit(req, 'billing.cancel', 'user', req.user.id, { immediate });
      return { ok: true, ...result };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/billing/archive', { preHandler: requireAuth }, async (req) => {
    const row = db.prepare('SELECT archive_until, archive_mb FROM users WHERE id=?').get(req.user.id);
    return {
      addon: archiveAddon(),
      activeUntil: row?.archive_until || null,
      archiveMb: row?.archive_mb || 0,
      providerConfigured: providerConfigured()
    };
  });

  // Старые «офферы PREMIUM» для обратной совместимости старого фронта
  app.get('/api/billing/offers', async () => {
    const offers = getPremiumOffers();
    return { offers, plans: listPlans({ activeOnly: true }), providerConfigured: providerConfigured() };
  });
}
