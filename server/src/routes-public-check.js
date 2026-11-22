import { verifyCodes } from './cz.js';

/**
 * Публичная проверка кодов для рекламного лендинга /check.
 * Без авторизации, максимум 3 кода за запрос и ограничение по IP.
 */
const buckets = new Map();
const statusCache = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 12;
const STATUS_TTL_MS = 2 * 60 * 1000;

function allowIp(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  let row = buckets.get(key);
  if (!row || now - row.reset > WINDOW_MS) {
    row = { count: 0, reset: now };
    buckets.set(key, row);
  }
  row.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.reset > WINDOW_MS) buckets.delete(k);
  }
  return row.count <= MAX_REQUESTS;
}

async function cachedVerify(code) {
  const hit = statusCache.get(code);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.result;
  const data = await verifyCodes([code], 'cz', { onlineLimit: 1 });
  const result = data.results?.[0] || null;
  if (result && buckets.size < 5000) statusCache.set(code, { at: Date.now(), result });
  if (statusCache.size > 1000) {
    const oldest = statusCache.keys().next();
    if (!oldest.done) statusCache.delete(oldest.value);
  }
  return result;
}

export async function registerPublicCheckRoutes(app) {
  app.post('/api/public/check', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!allowIp(req.ip)) return reply.code(429).send({ error: 'Слишком много проверок. Попробуйте позже или зарегистрируйтесь.' });
    const raw = Array.isArray(req.body?.codes) ? req.body.codes : [];
    const codes = raw
      .map((c) => String(c || '').trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!codes.length) return reply.code(400).send({ error: 'Вставьте хотя бы один код' });
    if (codes.some((c) => c.length > 300)) return reply.code(400).send({ error: 'Слишком длинный код' });

    const results = [];
    await Promise.all(codes.map(async (code) => {
      try {
        const row = await cachedVerify(code);
        results.push(row ? {
          code,
          ok: Boolean(row.ok),
          status: row.status || '',
          crypto: row.crypto || '',
          gtin: row.gtin || '',
          serial: row.serial || '',
          name: row.name || '',
          producer: row.producer || '',
          online: Boolean(row.online),
          warnings: Array.isArray(row.warnings) ? row.warnings.slice(0, 3) : [],
          error: row.error || ''
        } : { code, ok: false, error: 'Не удалось проверить код' });
      } catch (e) {
        results.push({ code, ok: false, error: String(e?.message || e).slice(0, 160) });
      }
    }));
    const order = new Map(codes.map((c, i) => [c, i]));
    results.sort((a, b) => (order.get(a.code) || 0) - (order.get(b.code) || 0));
    return {
      ok: true,
      results,
      onlineChecked: results.filter((r) => r.online).length,
      message: 'Проверка структуры GS1 и онлайн-статус через открытые источники «Честного ЗНАКа». Сервис не является официальным сервисом ЧЗ.'
    };
  });
}
