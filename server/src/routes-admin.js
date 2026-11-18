import { db, today } from './db.js';
import { requireAuth } from './routes.js';
import { activatePremium } from './billing.js';
import { getSetting, setSetting } from './settings.js';
import { getPremiumOffers, getTestPrice } from './plans.js';
import { czStatus } from './cz.js';
import { notifyStatusChange } from './notify.js';

const requireAdmin = async (req, reply) => {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Только для администратора' });
};

export async function registerAdminRoutes(app) {
  app.get('/api/admin/stats', { preHandler: requireAdmin }, async () => ({
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    premium: db.prepare("SELECT COUNT(*) c FROM users WHERE plan='premium'").get().c,
    jobs: db.prepare('SELECT COUNT(*) c FROM generation_jobs').get().c,
    codesToday: db.prepare('SELECT COALESCE(SUM(codes_generated),0) c FROM usage_daily WHERE day=?').get(today()).c,
    revenue: db.prepare("SELECT COALESCE(SUM(amount),0) c FROM orders WHERE status='paid'").get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
    cz: czStatus()
  }));

  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => ({
    users: db.prepare(`SELECT u.id, u.email, u.name, u.role, u.plan, u.created_at,
      COALESCE(d.codes_generated, 0) AS codes_today,
      (SELECT expires_at FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' ORDER BY expires_at DESC LIMIT 1) AS premium_until
      FROM users u LEFT JOIN usage_daily d ON d.user_id=u.id AND d.day=?
      ORDER BY u.id DESC LIMIT 200`).all(today())
  }));

  app.post('/api/admin/users/:id/plan', { preHandler: requireAdmin }, async (req, reply) => {
    const { plan } = req.body || {};
    if (!['free', 'premium'].includes(plan)) return reply.code(400).send({ error: 'Тариф: free или premium' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    if (plan === 'premium') {
      activatePremium(user.id, 'admin', null, null);
      notifyStatusChange(user, 'Администратор выдал PREMIUM на 30 дней');
    } else {
      db.transaction(() => {
        db.prepare("UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'").run(user.id);
        db.prepare("UPDATE users SET plan='free' WHERE id=?").run(user.id);
      })();
      notifyStatusChange(user, 'Администратор перевёл на FREE');
    }
    return { ok: true };
  });

  app.get('/api/admin/orders', { preHandler: requireAdmin }, async () => ({
    orders: db.prepare(`SELECT o.id, o.plan, o.amount, o.status, o.provider, o.created_at, o.paid_at, u.email
      FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 100`).all()
  }));

  app.get('/api/admin/settings', { preHandler: requireAdmin }, async () => ({
    czEnabled: getSetting('cz_enabled', '0') === '1',
    czApiUrl: getSetting('cz_api_url', 'https://api.mdlp.crpt.ru'),
    czConfigured: Boolean(getSetting('cz_token', ''))
  }));

  app.put('/api/admin/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const { czEnabled, czApiUrl, czToken } = req.body || {};
    if (czEnabled !== undefined) setSetting('cz_enabled', czEnabled ? '1' : '0');
    if (czApiUrl !== undefined) {
      if (!/^https:\/\//.test(String(czApiUrl))) return reply.code(400).send({ error: 'URL должен начинаться с https://' });
      setSetting('cz_api_url', String(czApiUrl).slice(0, 200));
    }
    if (czToken) setSetting('cz_token', String(czToken).slice(0, 500));
    return { ok: true };
  });

  // === Управление тарифами PREMIUM ===
  app.get('/api/admin/pricing', { preHandler: requireAdmin }, async () => ({
    offers: getPremiumOffers(),
    testPrice: getTestPrice()
  }));

  app.put('/api/admin/pricing', { preHandler: requireAdmin }, async (req, reply) => {
    const { offers, testPrice } = req.body || {};
    if (offers !== undefined) {
      if (!Array.isArray(offers) || offers.length === 0 || offers.length > 12) {
        return reply.code(400).send({ error: 'Нужен 1–12 периодов подписки' });
      }
      const seen = new Set();
      const clean = [];
      for (const o of offers) {
        const days = Math.round(Number(o.days));
        const price = Math.round(Number(o.price) * 100) / 100;
        const discount = o.discount === undefined || o.discount === '' ? 0 : Math.round(Number(o.discount));
        if (!Number.isFinite(days) || days < 1 || days > 3650) return reply.code(400).send({ error: 'Срок: 1–3650 дней' });
        if (!Number.isFinite(price) || price < 1 || price > 1000000) return reply.code(400).send({ error: 'Цена: 1–1 000 000 ₽' });
        if (!Number.isFinite(discount) || discount < 0 || discount > 90) return reply.code(400).send({ error: 'Скидка: 0–90%' });
        if (seen.has(days)) return reply.code(400).send({ error: 'Периоды не должны повторяться' });
        seen.add(days);
        clean.push({ days, price, discount });
      }
      clean.sort((a, b) => a.days - b.days);
      setSetting('premium_offers', JSON.stringify(clean));
    }
    if (testPrice !== undefined) {
      const tp = Math.round(Number(testPrice) * 100) / 100;
      if (!Number.isFinite(tp) || tp < 1 || tp > 1000000) return reply.code(400).send({ error: 'Цена TEST: 1–1 000 000 ₽' });
      setSetting('test_price', String(tp));
    }
    return { offers: getPremiumOffers(), testPrice: getTestPrice() };
  });
}
