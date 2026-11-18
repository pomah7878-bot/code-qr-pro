import { db, today } from './db.js';
import { requireAuth } from './routes.js';
import { activatePremium } from './billing.js';
import { getSetting, setSetting } from './settings.js';
import { czStatus } from './cz.js';

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
    } else {
      db.transaction(() => {
        db.prepare("UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'").run(user.id);
        db.prepare("UPDATE users SET plan='free' WHERE id=?").run(user.id);
      })();
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
}
