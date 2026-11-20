import { db } from './db.js';
import { requireAuth } from './routes.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { logEvent } from './lib/app-log.js';
import { aiConfig, aiConfigured, askAi } from './lib/ai-client.js';
import { searchKnowledge, kbContext, markKbCalls, listKbArticles, saveKbArticle, deleteKbArticle } from './lib/kb.js';
import { planOf } from './plans.js';

/**
 * Клиентский AI-помощник: база знаний + бесплатные модели.
 * Финансовые вопросы (оплата, скидки, возвраты) не решает — только подсказывает, где смотреть.
 * Сложные случаи эскалируются в поддержку (support_tickets).
 */

const LIMIT_CHAT_PER_HOUR = 60;
const LIMIT_TICKETS_PER_HOUR = 5;

function bumpLimit(key, limit, windowSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').get(key);
  if (!row || now - row.window_start > windowSec) {
    db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1').run(key, now);
    return { ok: true, left: limit - 1 };
  }
  if (row.count >= limit) return { ok: false, left: 0 };
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
  return { ok: true, left: limit - row.count - 1 };
}

function supportAccess(user) {
  const plan = planOf(user);
  return user.role === 'admin' || user.role === 'support' || plan.id === 'premium';
}

const SYSTEM = `Ты — AI-помощник сервиса CODE QR PRO (маркировка «Честный ЗНАК», GS1 DataMatrix, печать этикеток).
Помогаешь клиентам по работе сервиса и маркировке. Опирайся ТОЛЬКО на статьи базы знаний ниже.
Правила:
1. Отвечай по-русски, по делу, шагами, 3–7 предложений или короткий список. Без markdown-заголовков.
2. Не выдумывай функции, цены и сроки, которых нет в базе знаний.
3. Финансы (оплата, скидки, возвраты, счета) не решай: вежливо объясни, что это решает поддержка, и предложи передать обращение.
4. Не проси пароль, коды 2FA, API-ключи и не советуй передавать их кому-либо.
5. Не обещай действий от имени администратора. Если нужен доступ к аккаунту, сброс 2FA, разблокировка или вопрос про деньги — предложи «Передать в поддержку».
6. Если не уверен — так и скажи и предложи поддержку.

Верни строго JSON без markdown:
{"answer":"ответ клиенту","needHuman":true|false,"reason":"почему нужен человек (коротко)","sources":["заголовки статей"]}`;

export async function registerAiSupportRoutes(app) {
  app.post('/api/assistant/chat', { preHandler: requireAuth }, async (req, reply) => {
    const cfg = aiConfig();
    if (!cfg.enabled) return reply.code(400).send({ error: 'Помощник временно недоступен. Напишите в поддержку.' });
    if (!aiConfigured(cfg)) return reply.code(400).send({ error: 'Помощник временно недоступен. Напишите в поддержку.' });

    const user = req.user;
    if (!supportAccess(user)) {
      return reply.code(403).send({ error: 'AI-помощник доступен на тарифе PREMIUM. Оформите подписку в разделе «Подписка».', needPremium: true });
    }

    const message = String(req.body?.message || '').trim().slice(0, 1500);
    if (message.length < 3) return reply.code(400).send({ error: 'Опишите вопрос подробнее' });

    const limit = bumpLimit(`ai-support:u${user.id}`, LIMIT_CHAT_PER_HOUR);
    if (!limit.ok) return reply.code(429).send({ error: 'Слишком много вопросов подряд. Подождите немного или передайте обращение в поддержку.' });

    const articles = searchKnowledge(message, 4);
    const context = kbContext(articles);
    const started = Date.now();
    let answer = '';
    let needHuman = false;
    let reason = '';
    let model = cfg.model;
    let error = '';

    try {
      const res = await askAi({
        system: SYSTEM,
        user: `Вопрос клиента: ${message}\n\nБаза знаний:\n${context || '(подходящих статей не найдено)'}`,
        cfg,
        freeMaxTokens: 900
      });
      model = String(res.model || cfg.model).slice(0, 120);
      const parsed = res.parsed || {};
      answer = String(parsed.answer || res.content || '').trim().slice(0, 3000);
      needHuman = Boolean(parsed.needHuman);
      reason = String(parsed.reason || '').slice(0, 300);
      if (!answer) throw new Error('Пустой ответ помощника');
    } catch (e) {
      error = String(e?.message || e).slice(0, 300);
      logEvent({
        level: 'warn', source: 'support', event: 'client_ai_failed',
        message: `Клиентский AI: ${error}`, userId: user.id, ip: req.ip, method: 'USER', url: req.url,
        meta: { question: message.slice(0, 120) }
      });
    }

    const durationMs = Date.now() - started;
    if (!error) markKbCalls(articles.map((a) => a.id));

    if (error) {
      return reply.code(502).send({
        error: 'Помощник не смог ответить. Передайте вопрос в поддержку — администратор поможет.',
        needHuman: true
      });
    }

    return {
      answer,
      needHuman,
      reason,
      sources: articles.map((a) => ({ slug: a.slug, title: a.title })),
      model,
      durationMs,
      left: limit.left
    };
  });

  // Обращение в поддержку: клиент передаёт сложный вопрос человеку.
  app.post('/api/assistant/tickets', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.user;
    if (!supportAccess(user)) {
      return reply.code(403).send({ error: 'Обращения в поддержку доступны на тарифе PREMIUM.', needPremium: true });
    }
    const limit = bumpLimit(`ai-ticket:u${user.id}`, LIMIT_TICKETS_PER_HOUR);
    if (!limit.ok) return reply.code(429).send({ error: 'Слишком много обращений подряд. Попробуйте через час.' });

    const message = String(req.body?.message || '').trim().slice(0, 4000);
    if (message.length < 5) return reply.code(400).send({ error: 'Опишите проблему подробнее' });
    const subject = String(req.body?.subject || message.slice(0, 80)).trim().slice(0, 200);
    const aiContext = String(req.body?.aiContext || '').trim().slice(0, 4000);

    const info = db.prepare(
      'INSERT INTO support_tickets (user_id, subject, message, ai_context) VALUES (?,?,?,?)'
    ).run(user.id, subject, message, aiContext);

    logEvent({
      level: 'warn', source: 'support', event: 'ticket_created',
      message: `Обращение в поддержку #${info.lastInsertRowid} от ${user.email}`,
      userId: user.id, ip: req.ip, method: 'USER', url: req.url,
      meta: { subject: subject.slice(0, 120), ticketId: Number(info.lastInsertRowid) }
    });
    audit(req, 'support.ticket_create', 'support_ticket', Number(info.lastInsertRowid), { subject: subject.slice(0, 120) });

    return { ok: true, id: Number(info.lastInsertRowid), status: 'open' };
  });

  app.get('/api/assistant/tickets', { preHandler: requireAuth }, async (req) => {
    const rows = db.prepare(
      'SELECT id, subject, message, status, admin_note, created_at, updated_at FROM support_tickets WHERE user_id = ? ORDER BY id DESC LIMIT 20'
    ).all(req.user.id);
    return { tickets: rows };
  });

  // --- админ: обращения клиентов ---
  app.get('/api/admin/tickets', { preHandler: requireAdmin }, async (req) => {
    const status = String(req.query?.status || '').trim();
    const where = ['open', 'in_progress', 'resolved'].includes(status) ? 'WHERE t.status = ?' : '';
    const rows = db.prepare(
      `SELECT t.id, t.user_id, t.subject, t.message, t.ai_context, t.status, t.admin_note, t.created_at, t.updated_at,
              u.email, u.name
       FROM support_tickets t JOIN users u ON u.id = t.user_id
       ${where}
       ORDER BY (t.status = 'open') DESC, t.id DESC LIMIT 100`
    ).all(...(where ? [status] : []));
    const counts = db.prepare(
      "SELECT status, COUNT(*) c FROM support_tickets GROUP BY status"
    ).all();
    return { tickets: rows, counts: Object.fromEntries(counts.map((r) => [r.status, r.c])) };
  });

  app.patch('/api/admin/tickets/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT id, user_id FROM support_tickets WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ error: 'Обращение не найдено' });
    const status = ['open', 'in_progress', 'resolved'].includes(req.body?.status) ? req.body.status : null;
    const note = req.body?.adminNote !== undefined ? String(req.body.adminNote || '').slice(0, 3000) : null;
    db.prepare(
      `UPDATE support_tickets SET
         status = COALESCE(?, status),
         admin_note = COALESCE(?, admin_note),
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(status, note, id);
    audit(req, 'support.ticket_update', 'support_ticket', id, { status, note: note ? note.slice(0, 120) : undefined });
    if (status === 'resolved') {
      logEvent({
        level: 'info', source: 'support', event: 'ticket_resolved',
        message: `Обращение #${id} закрыто администратором`,
        userId: row.user_id, ip: req.ip, method: 'ADMIN', url: req.url, meta: { ticketId: id }
      });
    }
    return { ok: true, id, status, adminNote: note };
  });

  // --- база знаний: просмотр для админа ---
  app.get('/api/admin/kb', { preHandler: requireAdmin }, async () => ({ articles: listKbArticles() }));

  app.put('/api/admin/kb', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const id = saveKbArticle(req.body || {});
      audit(req, 'kb.save', 'kb_article', id, { title: String(req.body?.title || '').slice(0, 120) });
      return { ok: true, id };
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/admin/kb/:id', { preHandler: requireAdmin }, async (req) => {
    deleteKbArticle(req.params.id);
    audit(req, 'kb.delete', 'kb_article', Number(req.params.id), {});
    return { ok: true };
  });
}
