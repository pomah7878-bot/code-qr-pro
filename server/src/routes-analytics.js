import { recordVisit } from './lib/analytics.js';

/** Первичный трекер: публичный маяк просмотров страниц. */
export async function registerAnalyticsRoutes(app) {
  const hits = new Map();
  const allow = (ip) => {
    const now = Date.now();
    const key = String(ip || '');
    const list = (hits.get(key) || []).filter((t) => now - t < 60_000);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return list.length <= 120;
  };

  app.post('/api/analytics/collect', async (req, reply) => {
    if (!allow(req.ip)) return reply.code(204).send();
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      recordVisit(body, req);
    } catch { /* аналитика не должна влиять на страницу */ }
    return reply.code(204).send();
  });
}
