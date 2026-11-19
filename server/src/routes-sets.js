import { db } from './db.js';
import { requireAuth } from './routes.js';
import { planOf } from './plans.js';
import { renderSetsPdf, normalizeSetPayload, validateSetPayload, validGtin } from './sets.js';
import { logActivity } from './lib/activity.js';

const rowToTemplate = (r) => ({
  id: r.id,
  name: r.name,
  setGtin: r.set_gtin,
  format: r.format,
  components: (() => { try { const a = JSON.parse(r.components || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } })(),
  updatedAt: r.updated_at
});

function cleanTemplate(body = {}) {
  const p = normalizeSetPayload({ template: body, setCodes: ['x'], onlySet: true, componentCodes: [] });
  if (!p.name) return { error: 'Укажите название набора' };
  if (!validGtin(p.setGtin)) return { error: 'GTIN набора должен содержать 14 цифр с правильной контрольной цифрой' };
  if (!p.components.length) return { error: 'Добавьте хотя бы один товар в набор' };
  for (const c of p.components) {
    if (!validGtin(c.gtin)) return { error: `GTIN товара «${c.name || 'без названия'}» должен содержать 14 цифр с правильной контрольной цифрой` };
    if (!c.name) return { error: 'У каждого товара должно быть название' };
  }
  return { template: { name: p.name, setGtin: p.setGtin, format: p.format, components: p.components } };
}

export async function registerSetRoutes(app) {
  app.get('/api/sets/templates', { preHandler: requireAuth }, async (req) => ({
    templates: db.prepare('SELECT * FROM set_templates WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id).map(rowToTemplate)
  }));

  app.post('/api/sets/templates', { preHandler: requireAuth }, async (req, reply) => {
    const r = cleanTemplate(req.body);
    if (r.error) return reply.code(400).send({ error: r.error });
    const t = r.template;
    const info = db.prepare('INSERT INTO set_templates (user_id, name, set_gtin, format, components) VALUES (?,?,?,?,?)')
      .run(req.user.id, t.name, t.setGtin, t.format, JSON.stringify(t.components));
    return { template: rowToTemplate(db.prepare('SELECT * FROM set_templates WHERE id=?').get(info.lastInsertRowid)) };
  });

  app.put('/api/sets/templates/:id', { preHandler: requireAuth }, async (req, reply) => {
    const old = db.prepare('SELECT * FROM set_templates WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!old) return reply.code(404).send({ error: 'Шаблон не найден' });
    const r = cleanTemplate(req.body);
    if (r.error) return reply.code(400).send({ error: r.error });
    const t = r.template;
    db.prepare("UPDATE set_templates SET name=?, set_gtin=?, format=?, components=?, updated_at=datetime('now') WHERE id=?")
      .run(t.name, t.setGtin, t.format, JSON.stringify(t.components), old.id);
    return { template: rowToTemplate(db.prepare('SELECT * FROM set_templates WHERE id=?').get(old.id)) };
  });

  app.delete('/api/sets/templates/:id', { preHandler: requireAuth }, async (req, reply) => {
    const r = db.prepare('DELETE FROM set_templates WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    if (!r.changes) return reply.code(404).send({ error: 'Шаблон не найден' });
    return { ok: true };
  });

  app.post('/api/sets/pdf', { preHandler: requireAuth }, async (req, reply) => {
    const plan = planOf(req.user);
    if (!plan.labelEditor) return reply.code(403).send({ error: 'Печать наборов доступна на тарифе PREMIUM' });
    const p = normalizeSetPayload(req.body);
    const error = validateSetPayload(p);
    if (error) return reply.code(400).send({ error });
    try {
      const pdf = await renderSetsPdf(p);
      logActivity(req.user, 'sets_pdf', 'PDF наборов', {
        total: p.setCodes.length,
        ok: p.setCodes.length,
        meta: { setGtin: p.setGtin, components: p.components.length, onlySet: p.onlySet }
      });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'attachment; filename="nabor.pdf"');
      reply.header('Content-Length', String(pdf.length));
      return reply.send(pdf);
    } catch (e) {
      return reply.code(e.statusCode || 502).send({ error: String(e?.message || e) });
    }
  });
}
