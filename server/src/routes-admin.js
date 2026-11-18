import { db, today } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { getPremiumOffers, getTestPrice } from './plans.js';
import { czStatus } from './cz.js';
import { requireAdmin } from './lib/admin.js';

export async function registerAdminRoutes(app) {
  app.get('/api/admin/stats', { preHandler: requireAdmin }, async () => ({
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    premium: db.prepare("SELECT COUNT(*) c FROM users WHERE plan='premium'").get().c,
    blocked: db.prepare("SELECT COUNT(*) c FROM users WHERE status='blocked'").get().c,
    jobs: db.prepare('SELECT COUNT(*) c FROM generation_jobs').get().c,
    codesToday: db.prepare('SELECT COALESCE(SUM(codes_generated),0) c FROM usage_daily WHERE day=?').get(today()).c,
    revenue: db.prepare("SELECT COALESCE(SUM(amount),0) c FROM orders WHERE status='paid'").get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
    cz: czStatus()
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
