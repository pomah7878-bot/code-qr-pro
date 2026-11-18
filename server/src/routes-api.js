import { createHash, randomBytes } from 'node:crypto';
import { db, usageToday } from './db.js';
import { requireAuth } from './routes.js';
import { planOf } from './plans.js';
import { createJobForUser } from './routes-jobs.js';
import { verifyCodes } from './cz.js';
import { getSetting } from './settings.js';

const hashKey = (k) => createHash('sha256').update(k).digest('hex');

const requireApiKey = async (req, reply) => {
  const k = req.headers['x-api-key'];
  const row = k ? db.prepare('SELECT * FROM api_keys WHERE key_hash=?').get(hashKey(String(k))) : null;
  if (!row) return reply.code(401).send({ error: 'Неверный API-ключ (заголовок X-API-Key)' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  if (!user) return reply.code(401).send({ error: 'Неверный API-ключ (заголовок X-API-Key)' });
  if (user.status === 'blocked') return reply.code(403).send({ error: 'Аккаунт заблокирован' });
  if (!planOf(user).apiAccess) return reply.code(403).send({ error: 'API доступен на тарифе PREMIUM' });
  db.prepare("UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?").run(row.id);
  req.apiUser = user;
};

export async function registerApiRoutes(app) {
  app.post('/api/keys', { preHandler: requireAuth }, async (req, reply) => {
    if (!planOf(req.user).apiAccess) return reply.code(403).send({ error: 'API доступен на тарифе PREMIUM' });
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
    if (!Array.isArray(codes) || !codes.length || codes.length > 1000) return reply.code(400).send({ error: 'Передайте до 1000 кодов' });
    const mode = req.body?.mode === 'gs1' ? 'gs1' : 'cz';
    return verifyCodes(codes, mode);
  });

  // Информация о товаре из «Честного ЗНАКа» по коду (True API, если настроен токен)
  app.get('/api/cz/product', { preHandler: requireAuth }, async (req, reply) => {
    const code = String(req.query?.code || '').trim();
    if (!code) return reply.code(400).send({ error: 'Передайте код маркировки' });
    const enabled = getSetting('cz_enabled', '0') === '1';
    const token = getSetting('cz_token', '');
    const apiUrl = (getSetting('cz_api_url', 'https://api.mdlp.crpt.ru') || 'https://api.mdlp.crpt.ru').replace(/\/$/, '');
    if (!enabled || !token) {
      return { configured: false, product: null, message: 'Информация о товаре из ЧЗ не подключена — показываю GTIN и серийник из кода.' };
    }
    try {
      const res = await fetch(`${apiUrl}/api/v4/true-api/codes/check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: [code] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { configured: true, product: null, message: data?.error_message || data?.message || `ЧЗ вернул HTTP ${res.status}` };
      }
      const item = Array.isArray(data?.codes) ? data.codes[0] : (Array.isArray(data) ? data[0] : data);
      const product = {
        name: item?.productName || item?.product_name || item?.name || '',
        producer: item?.producerName || item?.producer || item?.ownerName || '',
        gtin: item?.gtin || '',
        status: item?.status || item?.codeStatus || ''
      };
      return { configured: true, product, raw: item || null };
    } catch (e) {
      return { configured: true, product: null, message: `Не удалось получить данные из ЧЗ: ${e.message}` };
    }
  });
}
