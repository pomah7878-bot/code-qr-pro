import { createDonationPayment } from './billing.js';

const buckets = new Map();
function allow(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.at > 60_000) { b = { n: 0, at: now }; buckets.set(key, b); }
  b.n += 1;
  return b.n <= 5;
}

export async function registerDonateRoutes(app) {
  app.post('/api/public/donate', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!allow(req.ip)) return reply.code(429).send({ error: 'Слишком много попыток. Подождите минуту.' });
    try {
      const result = await createDonationPayment({
        amount: req.body?.amount,
        email: String(req.body?.email || '').trim().slice(0, 160),
        message: String(req.body?.message || '').trim().slice(0, 500)
      });
      return { ok: true, ...result };
    } catch (e) {
      return reply.code(e.statusCode || 502).send({ error: String(e?.message || e) });
    }
  });
}
