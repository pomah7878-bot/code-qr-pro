import { db, today } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { czStatus } from './cz.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';

export async function registerAdminRoutes(app) {
  app.get('/api/admin/stats', { preHandler: requireAdmin }, async () => ({
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    paid: db.prepare("SELECT COUNT(*) c FROM users WHERE plan IN ('start','pro','business')").get().c,
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
    audit(req, 'settings.cz', 'settings', 'cz', {
      enabled: czEnabled !== undefined ? Boolean(czEnabled) : undefined,
      apiUrl: czApiUrl, tokenChanged: Boolean(czToken)
    });
    return { ok: true };
  });

}
