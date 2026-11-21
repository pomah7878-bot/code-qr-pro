import { createHash, randomBytes } from 'node:crypto';
import { db, usageToday } from './db.js';
import { requireAuth } from './routes.js';
import { planOf } from './plans.js';
import { createJobForUser } from './routes-jobs.js';
import { verifyCodes } from './cz.js';
import { getSetting } from './settings.js';
import { logActivity } from './lib/activity.js';
import { audit } from './lib/audit.js';
import { productCard } from './lib/product-card.js';
import { consumeOperations, UsageError } from './lib/usage.js';

const hashKey = (k) => createHash('sha256').update(k).digest('hex');

const requireApiKey = async (req, reply) => {
  const k = req.headers['x-api-key'];
  const row = k ? db.prepare('SELECT * FROM api_keys WHERE key_hash=?').get(hashKey(String(k))) : null;
  if (!row) return reply.code(401).send({ error: 'Неверный API-ключ (заголовок X-API-Key)' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  if (!user) return reply.code(401).send({ error: 'Неверный API-ключ (заголовок X-API-Key)' });
  if (user.status === 'blocked') return reply.code(403).send({ error: 'Аккаунт заблокирован' });
  if (!planOf(user).apiAccess) return reply.code(403).send({ error: 'API доступен на тарифе PRO и выше', feature: 'apiAccess' });
  db.prepare("UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?").run(row.id);
  req.apiUser = user;
};

const VARIABLE_AIS = new Set(['10', '21', '22', '30', '37', '240', '241', '242', '250', '251', '253', '254', '255', '91', '92', '93', '94', '95', '96', '97', '98', '99']);

function normalizeCis(code) {
  const s = String(code || '').trim();
  if (!/^\(\d{2,4}\)/.test(s)) return s;
  const starts = [...s.matchAll(/\((\d{2,4})\)/g)];
  let out = '';
  let prevVariable = false;
  for (let i = 0; i < starts.length; i++) {
    const ai = starts[i][1];
    const start = starts[i].index + starts[i][0].length;
    const end = i + 1 < starts.length ? starts[i + 1].index : s.length;
    const value = s.slice(start, end);
    if (i > 0 && prevVariable) out += '\x1d';
    out += ai + value;
    prevVariable = VARIABLE_AIS.has(ai);
  }
  return out;
}

export async function registerApiRoutes(app) {
  app.post('/api/keys', { preHandler: requireAuth }, async (req, reply) => {
    if (!planOf(req.user).apiAccess) return reply.code(403).send({ error: 'API доступен на тарифе PRO и выше', feature: 'apiAccess' });
    const name = String(req.body?.name || 'Ключ').slice(0, 60);
    const key = 'cq_' + randomBytes(24).toString('hex');
    db.prepare('INSERT INTO api_keys (user_id, name, key_hash, prefix) VALUES (?,?,?,?)')
      .run(req.user.id, name, hashKey(key), key.slice(0, 10));
    return { key, warning: 'Ключ показывается один раз — сохраните его' };
  });

  app.get('/api/keys', { preHandler: requireAuth }, async (req) => ({
    keys: db.prepare('SELECT id,name,prefix,created_at,last_used_at FROM api_keys WHERE user_id=? ORDER BY id DESC').all(req.user.id)
  }));

  app.delete('/api/keys/:id', { preHandler: requireAuth }, async (req, reply) => {
    const r = db.prepare('DELETE FROM api_keys WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    if (!r.changes) return reply.code(404).send({ error: 'Ключ не найден' });
    return { ok: true };
  });

  // Публичный API для 1С/складских систем
  app.post('/api/v1/generate', { preHandler: requireApiKey }, async (req, reply) => {
    const r = createJobForUser(req.apiUser, req.body);
    if (r.error) return reply.code(r.status).send({ error: r.error });
    return { job: r.job };
  });

  app.get('/api/v1/jobs/:id', { preHandler: requireApiKey }, async (req, reply) => {
    const job = db.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=?').get(req.params.id, req.apiUser.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено' });
    const items = db.prepare('SELECT row_index,raw,gtin,serial,status,error FROM job_items WHERE job_id=? ORDER BY row_index').all(job.id);
    return { job, items };
  });

  app.get('/api/v1/me', { preHandler: requireApiKey }, async (req) => ({
    user: { id: req.apiUser.id, email: req.apiUser.email, plan: req.apiUser.plan },
    plan: planOf(req.apiUser),
    usage: { codesToday: usageToday(req.apiUser.id) }
  }));

  // Проверка кодов «Честного ЗНАКа» (локальная валидация + статус ГИС МТ)
  app.post('/api/cz/verify', { preHandler: requireAuth }, async (req, reply) => {
    const codes = req.body?.codes;
    if (!Array.isArray(codes) || !codes.length || codes.length > 10000) return reply.code(400).send({ error: 'Передайте до 10 000 кодов' });
    const mode = req.body?.mode === 'gs1' ? 'gs1' : 'cz';
    const result = await verifyCodes(codes, mode);
    const ok = (result.results || []).filter((r) => r.ok).length;
    logActivity(req.user, 'cz_verify', 'Проверка кодов «Честный ЗНАК»', {
      total: codes.length, ok, fail: codes.length - ok,
      meta: { mode, configured: Boolean(result.configured), online: Boolean(result.online) }
    });
    return result;
  });

  // Личный токен ЧЗ (True API): клиент вставляет свой токен — карточки идут из ЧЗ
  app.get('/api/cz/token', { preHandler: requireAuth }, async (req) => {
    const t = String(req.user.cz_token || '');
    const globalToken = getSetting('cz_enabled', '0') === '1' && Boolean(getSetting('cz_token', ''));
    return { ok: true, configured: Boolean(t), tail: t ? t.slice(-6) : '', global: globalToken };
  });

  app.put('/api/cz/token', { preHandler: requireAuth }, async (req, reply) => {
    const token = String(req.body?.token || '').trim();
    if (token && token.length < 20) return reply.code(400).send({ error: 'Токен слишком короткий — скопируйте токен True API целиком' });
    db.prepare('UPDATE users SET cz_token = ? WHERE id = ?').run(token.slice(0, 4000), req.user.id);
    audit(req, 'cz.token_save', 'user', req.user.id, { configured: Boolean(token) });
    return { ok: true, configured: Boolean(token), tail: token ? token.slice(-6) : '' };
  });

  // Фото товара: картинку ищем на сервере (ЧЗ/открытые базы) и отдаём через свой домен.
  // CSP остаётся строгим, внешние хосты проверяются.
  app.get('/api/product/image', { preHandler: requireAuth }, async (req, reply) => {
    const allowed = [
      'crpt.ru', 'crptech.ru', 'xn--80ajghhoc2aj1c8b.xn--p1ai',
      'openfoodfacts.org', 'openbeautyfacts.org', 'openproductsfacts.org'
    ];
    const hostAllowed = (host) => allowed.some((d) => host === d || host.endsWith(`.${d}`));

    let target = null;
    const directUrl = String(req.query?.url || '');
    const gtin = String(req.query?.gtin || '').replace(/\D/g, '');
    if (directUrl) {
      try { target = new URL(directUrl); } catch { return reply.code(400).send({ error: 'Некорректный URL картинки' }); }
      if (target.protocol !== 'https:' || !hostAllowed(target.hostname.toLowerCase())) {
        return reply.code(403).send({ error: 'Этот источник картинок не разрешён' });
      }
    } else if (gtin) {
      const candidates = [...new Set([gtin, gtin.replace(/^0+/, '')])].filter((g) => g.length >= 8);
      const bases = ['https://world.openfoodfacts.org', 'https://world.openbeautyfacts.org', 'https://world.openproductsfacts.org'];
      for (const base of bases) {
        for (const cand of candidates) {
          try {
            const res = await fetch(`${base}/api/v2/product/${cand}.json?fields=image_front_url,image_url`, {
              headers: { Accept: 'application/json', 'User-Agent': 'CODE-QR-PRO/1.0' },
              signal: AbortSignal.timeout(10000)
            });
            if (!res.ok) continue;
            const data = await res.json().catch(() => null);
            const img = data?.product?.image_front_url || data?.product?.image_url || '';
            if (/^https:\/\//i.test(img)) {
              const candidate = new URL(img);
              if (hostAllowed(candidate.hostname.toLowerCase())) { target = candidate; break; }
            }
          } catch { /* следующий источник */ }
        }
        if (target) break;
      }
      if (!target) return reply.code(404).send({ error: 'Фото для этого товара не найдено' });
    } else {
      return reply.code(400).send({ error: 'Передайте url или gtin' });
    }

    try {
      const res = await fetch(target.toString(), {
        headers: { 'User-Agent': 'CODE-QR-PRO/1.0 (+https://code-qr.stockcity.ru)', Accept: 'image/*' },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) return reply.code(404).send({ error: `Картинка недоступна (HTTP ${res.status})` });
      const type = String(res.headers.get('content-type') || '');
      if (!type.startsWith('image/')) return reply.code(400).send({ error: 'Это не картинка' });
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length || buffer.length > 4 * 1024 * 1024) return reply.code(413).send({ error: 'Картинка слишком большая' });
      reply.header('Content-Type', type);
      reply.header('Cache-Control', 'public, max-age=86400, immutable');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(buffer);
    } catch (e) {
      return reply.code(502).send({ error: `Не удалось загрузить картинку: ${String(e?.message || e).slice(0, 120)}` });
    }
  });

  // Расширенная проверка DataMatrix: локальный разбор + каталог по GTIN + статус кода.
  // Внешние API вызываются только на сервере; операции и проверки списываются раздельно.
  app.post('/api/product/cards', { preHandler: requireAuth }, async (req, reply) => {
    const codes = Array.isArray(req.body?.codes) ? req.body.codes.slice(0, 50) : [];
    if (!codes.length) return reply.code(400).send({ error: 'Передайте список кодов' });
    const idemBase = String(req.body?.idemKey || req.headers['x-idempotency-key'] || '').slice(0, 100);
    const cards = [];
    let quotaError = null;
    for (let index = 0; index < codes.length; index += 1) {
      const item = codes[index];
      const code = typeof item === 'string' ? item : String(item?.code || '');
      const gtin = typeof item === 'string' ? '' : String(item?.gtin || '');
      const idemKey = idemBase ? `${idemBase}:${index}` : '';
      try {
        // операция — обработка одного кода; списываем до внешних запросов
        consumeOperations(req.user, 1, { idemKey: idemKey ? `${idemKey}:op` : '', context: 'product_card' });
        const card = await productCard({ user: req.user, code, gtin, idemKey });
        cards.push(card);
      } catch (e) {
        if (e instanceof UsageError) quotaError = quotaError || e;
        cards.push({ ok: false, error: String(e?.message || e), code, quota: e instanceof UsageError ? e.payload : null });
      }
    }
    logActivity(req.user, 'product_card', 'Карточка товара по коду', {
      total: codes.length,
      ok: cards.filter((c) => c.ok).length
    });
    if (quotaError && cards.every((c) => !c.ok)) {
      return reply.code(402).send({ error: quotaError.message, ...quotaError.payload, cards });
    }
    return { cards, quota: quotaError ? quotaError.payload : null };
  });

  // Информация о товаре из «Честного ЗНАКа» по коду (True API, если настроен токен)
  app.get('/api/cz/product', { preHandler: requireAuth }, async (req, reply) => {
    const code = String(req.query?.code || '').trim();
    const gtin = String(req.query?.gtin || '').trim();
    if (!code && !gtin) return reply.code(400).send({ error: 'Передайте код маркировки или GTIN' });
    const enabled = getSetting('cz_enabled', '0') === '1';
    const token = getSetting('cz_token', '');
    const apiUrl = (getSetting('cz_api_url', 'https://api.mdlp.crpt.ru') || 'https://api.mdlp.crpt.ru').replace(/\/$/, '');
    if (!enabled || !token) {
      return { configured: false, product: null, message: 'Информация о товаре из ЧЗ не подключена — показываю GTIN и серийник из кода.' };
    }

    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    let product = null;
    let message = '';

    // 5.1.2 True API: /api/v3/true-api/cises/info — подробная информация по коду
    if (code) {
      try {
        const res = await fetch(`${apiUrl}/api/v3/true-api/cises/info`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify([normalizeCis(code)])
        });
        const data = await res.json().catch(() => ({}));
        const item = Array.isArray(data) ? data[0] : data;
        const info = item?.cisInfo;
        if (info) {
          product = {
            name: info.productName || '',
            producer: info.producerName || info.ownerName || '',
            gtin: info.gtin || gtin,
            status: info.status || '',
            brand: info.brand || '',
            group: info.productGroup || '',
            owner: info.ownerName || '',
            emissionDate: info.emissionDate || ''
          };
        }
        if (item?.errorMessage) message = item.errorMessage;
        if (!res.ok && !product) message = data?.error_message || data?.message || `ЧЗ вернул HTTP ${res.status}`;
      } catch (e) {
        message = `Не удалось получить данные из ЧЗ: ${e.message}`;
      }
    }

    // Резерв: 5.6.1 True API: карточка товара по GTIN
    if ((!product || !product.name) && gtin) {
      try {
        const res = await fetch(`${apiUrl}/api/v4/true-api/product/info`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ gtins: [gtin] })
        });
        const data = await res.json().catch(() => ({}));
        const card = data?.results?.[0];
        if (card) {
          product = {
            ...(product || {}),
            name: card.name || product?.name || '',
            brand: card.brand || product?.brand || '',
            group: card.productGroup || product?.group || '',
            gtin: card.gtin || gtin,
            status: product?.status || '',
            producer: product?.producer || ''
          };
        }
        if (!res.ok && !product) message = data?.error_message || data?.message || `ЧЗ вернул HTTP ${res.status}`;
      } catch (e) {
        if (!product) message = `Не удалось получить карточку товара: ${e.message}`;
      }
    }

    if (!product) return { configured: true, product: null, message: message || 'Информация о товаре не найдена в ЧЗ' };
    return { configured: true, product, message };
  });
}
