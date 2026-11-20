import { db } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { logEvent } from './lib/app-log.js';
import { buildAiContext, formatAiContext } from './lib/ai-context.js';
import { aiConfig, aiConfigured, askAi, testAiProvider } from './lib/ai-client.js';

/** Действия, которые AI может предложить администратору (выполняет их человек). */
const ALLOWED_ACTIONS = [
  'unlock_login', 'reset_2fa', 'login_link', 'reset_usage', 'clear_password_flag',
  'clear_rate_limits', 'compensate', 'revoke_api_keys', 'view_as_client', 'send_email'
];
const ALLOWED = new Set(ALLOWED_ACTIONS);

const SYSTEM = `Ты — «AI-помощник» админ-панели CODE QR PRO: сервис генерации GS1 DataMatrix, проверки кодов «Честный ЗНАК», наборов с КИН и печати этикеток.
Тебе дают вопрос администратора и факты об аккаунте клиента. Нужно быстро поставить диагноз и предложить действия.

Правила:
1. Опирайся ТОЛЬКО на факты из данных. Если данных не хватает — так и напиши, поставь confidence "low".
2. Не выдумывай статусы, даты и ошибки, которых нет в данных.
3. Отвечай по-русски, кратко и по делу. Без воды.
4. Не предлагай нарушать закон и не советуй подделывать коды маркировки.
5. Не предлагай удаление аккаунта, смену роли и другие необратимые действия.
6. Действия выбирай только из списка разрешённых.

Разрешённые действия (id):
unlock_login — снять блокировку входа после неудачных попыток;
reset_2fa — сбросить 2FA (клиент потерял телефон);
login_link — одноразовая ссылка входа на 15 минут;
reset_usage — обнулить дневной лимит кодов;
clear_password_flag — снять требование сменить пароль при входе;
clear_rate_limits — снять лимит запросов по IP клиента;
compensate — компенсация: продлить PREMIUM (1–90 дней);
revoke_api_keys — отозвать все API-ключи клиента;
view_as_client — посмотреть кабинет от имени клиента (только чтение);
send_email — отправить клиенту письмо по шаблону.

Верни строго JSON без markdown:
{"diagnosis":"1–3 предложения: в чём причина","steps":["шаг 1","шаг 2"],"actions":["unlock_login"],"draft":"черновик короткого письма клиенту, 2–4 предложения","confidence":"high|medium|low"}`;

const safeParse = (value) => {
  try { return JSON.parse(value); } catch { return null; }
};

const SYSTEM_DRAFT = `Ты — помощник поддержки CODE QR PRO (маркировка «Честный ЗНАК», DataMatrix, печать этикеток).
Составь готовое письмо клиенту по проблеме, которую описал администратор, и по фактам аккаунта.

Требования:
1. Пиши на «вы», вежливо и по делу, 3–6 коротких предложений.
2. Структура: приветствие (по имени, если известно) → суть → что сделано/что нужно от клиента → при необходимости ссылка на раздел кабинета.
3. Без markdown, без эмодзи, без рекламы и лишних извинений.
4. Не выдумывай факты, которых нет в данных. Не обещай того, чего не произошло.
5. Подпись — «Команда CODE QR PRO».
6. Тема письма — до 80 символов.
7. Не упоминай e-mail, IP, ID аккаунта и другие технические детали — пиши человеческим языком.

Верни строго JSON без markdown:
{"subject":"тема письма","text":"полный текст письма с приветствием и подписью"}`;

export async function registerAdminAiRoutes(app) {
  app.get('/api/admin/ai/settings', { preHandler: requireAdmin }, async () => {
    const cfg = aiConfig();
    return {
      enabled: cfg.enabled,
      backend: cfg.backend,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      hasKey: Boolean(cfg.apiKey),
      configured: aiConfigured(cfg),
      allowedActions: ALLOWED_ACTIONS
    };
  });

  app.put('/api/admin/ai/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    if (b.baseUrl !== undefined && String(b.baseUrl).trim() && !/^https?:\/\/[^\s]+$/i.test(String(b.baseUrl).trim())) {
      return reply.code(400).send({ error: 'Base URL должен начинаться с http:// или https://' });
    }
    const pairs = [
      ['ai_enabled', b.enabled !== undefined ? (b.enabled ? '1' : '0') : undefined],
      ['ai_backend', ['api', 'dsh'].includes(b.backend) ? b.backend : undefined],
      ['ai_base_url', b.baseUrl !== undefined ? String(b.baseUrl).trim().slice(0, 300) : undefined],
      ['ai_model', b.model !== undefined ? String(b.model).trim().slice(0, 120) : undefined],
      ['ai_max_tokens', b.maxTokens !== undefined ? String(Math.min(3000, Math.max(300, Number(b.maxTokens) || 900))) : undefined],
      ['ai_api_key', b.clearKey ? '' : (b.apiKey && String(b.apiKey).trim() ? String(b.apiKey).trim() : undefined)]
    ];
    for (const [key, value] of pairs) {
      if (value === undefined) continue;
      setSetting(key, value);
    }
    audit(req, 'settings.ai', 'settings', 'ai', {
      enabled: b.enabled, backend: b.backend, model: b.model, keyChanged: Boolean(b.apiKey), cleared: Boolean(b.clearKey)
    });
    return { ok: true, configured: aiConfigured() };
  });

  app.post('/api/admin/ai/test', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const r = await testAiProvider();
      audit(req, 'ai.test', 'settings', 'ai', { backend: r.backend });
      return { ok: true, ...r };
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e) });
    }
  });

  app.post('/api/admin/ai/ask', { preHandler: requireAdmin }, async (req, reply) => {
    const cfg = aiConfig();
    if (!cfg.enabled) return reply.code(400).send({ error: 'AI-помощник выключен. Включите его в «Настройки → AI-помощник».' });
    if (!aiConfigured(cfg)) return reply.code(400).send({ error: 'AI не настроен: добавьте API-ключ в настройках или установите DSH на сервер.' });

    const userId = Number(req.body?.userId);
    const question = String(req.body?.question || '').trim().slice(0, 2000);
    if (!userId) return reply.code(400).send({ error: 'Не передан клиент' });
    if (question.length < 3) return reply.code(400).send({ error: 'Опишите проблему (минимум 3 символа)' });

    const used = db.prepare(
      "SELECT COUNT(*) c FROM ai_queries WHERE admin_id=? AND created_at > datetime('now','-1 hour')"
    ).get(req.user.id).c;
    if (used >= 30) return reply.code(429).send({ error: 'Лимит AI-запросов: 30 в час. Попробуйте позже.' });

    const ctx = buildAiContext(userId);
    if (!ctx) return reply.code(404).send({ error: 'Клиент не найден' });

    const started = Date.now();
    let status = 'ok';
    let error = '';
    let parsed = null;
    let content = '';
    let model = cfg.model;
    let actions = [];

    try {
      const res = await askAi({
        system: SYSTEM,
        user: `Вопрос администратора: ${question}\n\nДанные аккаунта:\n${formatAiContext(ctx)}`,
        cfg
      });
      content = String(res.content || '').slice(0, 4000);
      model = String(res.model || cfg.model).slice(0, 120);
      parsed = res.parsed;
      if (parsed && Array.isArray(parsed.actions)) {
        actions = parsed.actions.filter((a) => ALLOWED.has(a)).slice(0, 5);
      }
    } catch (e) {
      status = 'error';
      error = String(e?.message || e).slice(0, 500);
      logEvent({
        level: 'warn', source: 'ai', event: 'ai_failed',
        message: `AI-помощник: ${error}`, userId, ip: req.ip, method: 'ADMIN', url: req.url,
        meta: { question: question.slice(0, 120), model: cfg.model, backend: cfg.backend }
      });
    }

    const durationMs = Date.now() - started;
    const answer = {
      diagnosis: String(parsed?.diagnosis || (status === 'ok' ? content : '') || '').slice(0, 1500),
      steps: Array.isArray(parsed?.steps) ? parsed.steps.slice(0, 6).map((s) => String(s).slice(0, 300)) : [],
      draft: String(parsed?.draft || '').slice(0, 2000),
      confidence: ['high', 'medium', 'low'].includes(parsed?.confidence) ? parsed.confidence : 'medium'
    };

    const info = db.prepare(
      'INSERT INTO ai_queries (user_id, admin_id, question, answer, actions, model, backend, status, error, duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(userId, req.user.id, question, JSON.stringify(answer), JSON.stringify(actions), model, cfg.backend, status, error, durationMs);

    audit(req, 'ai.ask', 'user', userId, { question: question.slice(0, 120), status, actions, durationMs, model });

    if (status === 'error') return reply.code(502).send({ error, id: info.lastInsertRowid });
    return { id: info.lastInsertRowid, ...answer, actions, model, backend: cfg.backend, durationMs };
  });

  // AI сам пишет письмо клиенту: админ только проверяет и отправляет.
  app.post('/api/admin/ai/draft-message', { preHandler: requireAdmin }, async (req, reply) => {
    const cfg = aiConfig();
    if (!cfg.enabled) return reply.code(400).send({ error: 'AI-помощник выключен. Включите его в «Настройки → AI-помощник».' });
    if (!aiConfigured(cfg)) return reply.code(400).send({ error: 'AI не настроен: добавьте API-ключ в настройках или установите DSH на сервер.' });

    const userId = Number(req.body?.userId);
    const note = String(req.body?.note || '').trim().slice(0, 1000);
    const hint = String(req.body?.hint || '').trim().slice(0, 1500);
    if (!userId) return reply.code(400).send({ error: 'Не передан клиент' });

    const used = db.prepare(
      "SELECT COUNT(*) c FROM ai_queries WHERE admin_id=? AND created_at > datetime('now','-1 hour')"
    ).get(req.user.id).c;
    if (used >= 30) return reply.code(429).send({ error: 'Лимит AI-запросов: 30 в час. Попробуйте позже.' });

    const ctx = buildAiContext(userId);
    if (!ctx) return reply.code(404).send({ error: 'Клиент не найден' });

    const started = Date.now();
    let subject = '';
    let text = '';
    let model = cfg.model;
    let error = '';
    try {
      const res = await askAi({
        system: SYSTEM_DRAFT,
        user: [
          note ? `Что случилось / что сделано (со слов администратора): ${note}` : 'Администратор не дал пояснений — опирайся только на факты аккаунта.',
          hint ? `Дополнительный контекст (предыдущий разбор): ${hint}` : '',
          '',
          'Факты аккаунта:',
          // контакты и технические id в письмо попадать не должны
          formatAiContext(ctx).replace(/[a-z0-9]\*+@[a-z0-9.-]+/gi, 'клиент')
        ].filter(Boolean).join('\n'),
        cfg
      });
      model = String(res.model || cfg.model).slice(0, 120);
      const parsed = res.parsed || {};
      subject = String(parsed.subject || '').trim().slice(0, 120);
      text = String(parsed.text || '').trim().slice(0, 5000);
      if (!subject || !text) throw new Error('AI не вернул письмо, попробуйте ещё раз');
    } catch (e) {
      error = String(e?.message || e).slice(0, 400);
      logEvent({
        level: 'warn', source: 'ai', event: 'ai_draft_failed',
        message: `AI-письмо: ${error}`, userId, ip: req.ip, method: 'ADMIN', url: req.url,
        meta: { note: note.slice(0, 120), model: cfg.model, backend: cfg.backend }
      });
    }

    const durationMs = Date.now() - started;
    const info = db.prepare(
      'INSERT INTO ai_queries (user_id, admin_id, question, answer, actions, model, backend, status, error, duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(
      userId, req.user.id, `Черновик письма: ${note || 'без пояснений'}`.slice(0, 2000),
      JSON.stringify({ diagnosis: '', steps: [], draft: text, subject, confidence: 'medium' }),
      '[]', model, cfg.backend, error ? 'error' : 'ok', error, durationMs
    );

    audit(req, 'ai.draft_message', 'user', userId, { status: error ? 'error' : 'ok', model, durationMs, note: note.slice(0, 120) });
    if (error) return reply.code(502).send({ error, id: info.lastInsertRowid });
    return { id: info.lastInsertRowid, subject, text, model, backend: cfg.backend, durationMs };
  });

  app.get('/api/admin/ai/history', { preHandler: requireAdmin }, async (req) => {
    const userId = Number(req.query?.userId) || 0;
    const rows = db.prepare(
      'SELECT id, user_id, question, answer, actions, model, backend, status, error, duration_ms, created_at FROM ai_queries WHERE (? = 0 OR user_id = ?) ORDER BY id DESC LIMIT 20'
    ).all(userId, userId);
    return {
      queries: rows.map((r) => ({
        ...r,
        answer: safeParse(r.answer) || { diagnosis: '', steps: [], draft: '', confidence: 'low' },
        actions: safeParse(r.actions) || []
      }))
    };
  });
}
