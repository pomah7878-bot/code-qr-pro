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

const SYSTEM = `Ты — AI-помощник админки CODE QR PRO (маркировка «Честный ЗНАК», DataMatrix, печать этикеток).
По фактам аккаунта поставь диагноз и предложи шаги. Опирайся только на факты; не выдумывай; отвечай по-русски, кратко.
Не советуй нарушать закон и не предлагай удаление аккаунта/смену роли. Действия — только из списка:
unlock_login, reset_2fa, login_link, reset_usage, clear_password_flag, clear_rate_limits, compensate, revoke_api_keys, view_as_client, send_email.

Верни строго JSON без markdown:
{"diagnosis":"1–2 предложения","steps":["шаг 1","шаг 2"],"actions":["unlock_login"],"draft":"2–3 предложения клиенту","confidence":"high|medium|low"}`;

const safeParse = (value) => {
  try { return JSON.parse(value); } catch { return null; }
};

/** Баланс платного аккаунта DeepSeek (кэш 5 минут, запрос не тратит токены). */
let balanceCache = { at: 0, data: null };
async function deepseekBalance(cfg) {
  if (Date.now() - balanceCache.at < 5 * 60 * 1000) return balanceCache.data;
  const key = (/^sk-/.test(cfg.apiKey) ? cfg.apiKey : '') || process.env.DEEPSEEK_API_KEY || '';
  if (!key) {
    balanceCache = { at: Date.now(), data: { available: false, error: 'Ключ DeepSeek не задан' } };
    return balanceCache.data;
  }
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const info = Array.isArray(j.balance_infos) ? j.balance_infos[0] : null;
    balanceCache = {
      at: Date.now(),
      data: {
        available: Boolean(j.is_available),
        currency: info?.currency || 'USD',
        total: Number(info?.total_balance) || 0,
        granted: Number(info?.granted_balance) || 0,
        toppedUp: Number(info?.topped_up_balance) || 0
      }
    };
  } catch (e) {
    balanceCache = { at: Date.now(), data: { available: false, error: String(e?.message || e).slice(0, 200) } };
  }
  return balanceCache.data;
}

/** Сколько бесплатных моделей сейчас в пуле Kilo (кэш 10 минут). */
let kiloCache = { at: 0, data: null };
async function kiloFreeModels() {
  if (Date.now() - kiloCache.at < 10 * 60 * 1000) return kiloCache.data;
  try {
    const res = await fetch('https://api.kilo.ai/api/gateway/models', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const data = Array.isArray(j.data) ? j.data : [];
    const free = data.filter((m) => m.isFree === true || /free/i.test(String(m.id)));
    kiloCache = {
      at: Date.now(),
      data: {
        available: true,
        freeModels: free.length,
        totalModels: data.length,
        freeSample: free.map((m) => m.id).filter((id) => id !== 'kilo-auto/free' && id !== 'openrouter/free').slice(0, 6)
      }
    };
  } catch (e) {
    kiloCache = { at: Date.now(), data: { available: false, error: String(e?.message || e).slice(0, 200) } };
  }
  return kiloCache.data;
}

// Ориентир по цене DeepSeek (deepseek-chat, $/1M токенов) — для оценки «хватит на N разборов».
const PRICE_INPUT_PER_M = 0.27;
const PRICE_OUTPUT_PER_M = 1.1;

function aiUsageToday() {
  const rows = db.prepare(
    `SELECT COALESCE(NULLIF(via, ''), 'account') AS v, COUNT(*) AS c,
            COALESCE(SUM(prompt_tokens), 0) AS p, COALESCE(SUM(completion_tokens), 0) AS co
     FROM ai_queries
     WHERE status = 'ok' AND created_at >= datetime('now', 'start of day')
     GROUP BY v`
  ).all();
  const out = {
    free: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    account: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  };
  for (const r of rows) {
    const key = r.v === 'free' ? 'free' : 'account';
    out[key].requests += r.c;
    out[key].promptTokens += r.p;
    out[key].completionTokens += r.co;
    out[key].totalTokens += r.p + r.co;
  }
  out.lastHour = db.prepare(
    "SELECT COUNT(*) c FROM ai_queries WHERE created_at > datetime('now','-1 hour')"
  ).get().c;
  return out;
}

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
      freeFirst: cfg.freeFirst,
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
      ['ai_max_tokens', b.maxTokens !== undefined ? String(Math.min(3000, Math.max(300, Number(b.maxTokens) || 600))) : undefined],
      ['ai_free_first', b.freeFirst !== undefined ? (b.freeFirst ? '1' : '0') : undefined],
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
    let via = '';
    let usage = null;

    try {
      const facts = formatAiContext(ctx);
      const res = await askAi({
        system: SYSTEM,
        // факты обрезаем: модель не должна получать лишние токены
        user: `Вопрос: ${question}\n\nФакты:\n${facts.length > 1600 ? facts.slice(0, 1600) + '…' : facts}`,
        cfg,
        freeMaxTokens: 900
      });
      content = String(res.content || '').slice(0, 4000);
      model = String(res.model || cfg.model).slice(0, 120);
      via = res.via || '';
      usage = res.usage || null;
      parsed = res.parsed;
      if (!parsed && content) {
        // бесплатная модель ответила текстом — не тратим аккаунт ради переформатирования
        parsed = { diagnosis: content.slice(0, 900), steps: [], actions: [], draft: '', confidence: 'low' };
      }
      if (res.via === 'account' && Array.isArray(res.freeErrors) && res.freeErrors.length) {
        logEvent({
          level: 'warn', source: 'ai', event: 'ai_account_fallback',
          message: 'AI: бесплатные модели недоступны, ответ дал аккаунт',
          userId, ip: req.ip, method: 'ADMIN', url: req.url,
          meta: { errors: res.freeErrors.join(' | ').slice(0, 500) }
        });
      }
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
      'INSERT INTO ai_queries (user_id, admin_id, question, answer, actions, model, backend, status, error, duration_ms, prompt_tokens, completion_tokens, via) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      userId, req.user.id, question, JSON.stringify(answer), JSON.stringify(actions), model, cfg.backend, status, error, durationMs,
      Number(usage?.prompt_tokens) || 0, Number(usage?.completion_tokens) || 0, via
    );

    audit(req, 'ai.ask', 'user', userId, { question: question.slice(0, 120), status, actions, durationMs, model, via });

    if (status === 'error') return reply.code(502).send({ error, id: info.lastInsertRowid });
    return { id: info.lastInsertRowid, ...answer, actions, model, backend: cfg.backend, via, durationMs };
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
    let via = '';
    let usage = null;
    try {
      const facts = formatAiContext(ctx).replace(/[a-z0-9]\*+@[a-z0-9.-]+/gi, 'клиент');
      const res = await askAi({
        system: SYSTEM_DRAFT,
        user: [
          note ? `Что случилось / что сделано (со слов администратора): ${note}` : 'Администратор не дал пояснений — опирайся только на факты аккаунта.',
          hint ? `Дополнительный контекст (предыдущий разбор): ${hint.slice(0, 400)}` : '',
          '',
          'Факты аккаунта:',
          // контакты и технические id в письмо попадать не должны
          facts.length > 1400 ? facts.slice(0, 1400) + '…' : facts
        ].filter(Boolean).join('\n'),
        cfg,
        freeMaxTokens: 900
      });
      model = String(res.model || cfg.model).slice(0, 120);
      via = res.via || '';
      usage = res.usage || null;
      const parsed = res.parsed || {};
      subject = String(parsed.subject || '').trim().slice(0, 120);
      text = String(parsed.text || '').trim().slice(0, 5000);
      if ((!subject || !text) && res.content) {
        // модель ответила обычным текстом — используем его, чтобы не тратить аккаунт
        const plain = String(res.content).trim();
        const lines = plain.split(/\n+/).map((s) => s.trim()).filter(Boolean);
        if (!subject && lines.length) subject = lines[0].replace(/^["«]+|["»]+$/g, '').slice(0, 120);
        if (!text) text = plain.slice(0, 5000);
      }
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
      'INSERT INTO ai_queries (user_id, admin_id, question, answer, actions, model, backend, status, error, duration_ms, prompt_tokens, completion_tokens, via) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      userId, req.user.id, `Черновик письма: ${note || 'без пояснений'}`.slice(0, 2000),
      JSON.stringify({ diagnosis: '', steps: [], draft: text, subject, confidence: 'medium' }),
      '[]', model, cfg.backend, error ? 'error' : 'ok', error, durationMs,
      Number(usage?.prompt_tokens) || 0, Number(usage?.completion_tokens) || 0, via
    );

    audit(req, 'ai.draft_message', 'user', userId, { status: error ? 'error' : 'ok', model, via, durationMs, note: note.slice(0, 120) });
    if (error) return reply.code(502).send({ error, id: info.lastInsertRowid });
    return { id: info.lastInsertRowid, subject, text, model, backend: cfg.backend, via, durationMs };
  });

  // Использование и остатки: бесплатные модели Kilo + баланс платного аккаунта.
  app.get('/api/admin/ai/usage', { preHandler: requireAdmin }, async () => {
    const cfg = aiConfig();
    const [balance, kilo] = await Promise.all([deepseekBalance(cfg), kiloFreeModels()]);
    const today = aiUsageToday();
    const acc = today.account;
    // средний расход на один платный разбор — по фактическим данным, иначе ориентир
    const avgTokens = acc.promptTokens > 0
      ? { prompt: Math.round(acc.promptTokens / acc.requests), completion: Math.round(acc.completionTokens / acc.requests) }
      : { prompt: 1400, completion: 350 };
    const costPerQuery = (avgTokens.prompt * PRICE_INPUT_PER_M + avgTokens.completion * PRICE_OUTPUT_PER_M) / 1_000_000;
    const estimatedQueries = balance.available && costPerQuery > 0
      ? Math.floor(balance.total / costPerQuery)
      : null;
    return {
      free: {
        enabled: cfg.freeFirst,
        models: kilo.freeModels || 0,
        totalModels: kilo.totalModels || 0,
        available: Boolean(kilo.available),
        sample: kilo.freeSample || [],
        error: kilo.error || '',
        today: today.free
      },
      account: {
        backend: cfg.backend,
        model: cfg.model,
        balance,
        today: acc,
        avgTokens,
        costPerQuery: Number(costPerQuery.toFixed(5)),
        estimatedQueries
      },
      lastHour: today.lastHour,
      updatedAt: new Date().toISOString()
    };
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

