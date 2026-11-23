import { db, usageToday } from './db.js';
import { requireAuth } from './routes.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { logEvent } from './lib/app-log.js';
import { aiConfig, aiConfigured, askAi } from './lib/ai-client.js';
import { planOf } from './plans.js';
import { searchKnowledge, kbContext, markKbCalls, listKbArticles, listPublicKbArticles, getPublicKbArticle, saveKbArticle, deleteKbArticle } from './lib/kb.js';
import { notifySupportTicket } from './notify.js';
import { publicUrl } from './lib/public-url.js';
import { buildAiContext, formatAiContext } from './lib/ai-context.js';

/** Действия, которые админ может выполнить по обращению (кнопками в карточке клиента). */
const SUPPORT_ACTIONS = [
  'unlock_login', 'reset_2fa', 'login_link', 'reset_usage', 'clear_password_flag',
  'clear_rate_limits', 'compensate', 'revoke_api_keys', 'view_as_client', 'send_email'
];

const SUPPORT_SOLVER_SYSTEM = `Ты — старший инженер поддержки CODE QR PRO (маркировка «Честный ЗНАК», GS1 DataMatrix, печать этикеток).
Администратор прислал обращение клиента. Проанализируй его вместе с фактами аккаунта и предложи решение.

Правила:
1. Поставь точный диагноз по фактам, не выдумывай.
2. Дай 2–5 конкретных шагов для администратора: что проверить и что сделать.
3. Предложи готовый ответ клиенту (2–4 предложения, вежливо, от имени команды CODE QR PRO).
4. Действия выбирай только из списка: ${SUPPORT_ACTIONS.join(', ')}. Финансы (скидки, возвраты) не решай — предложи вежливый ответ и ручное решение.
5. Не проси у клиента пароль, коды 2FA или API-ключи.
12. Учитывай командный доступ: у аккаунта могут быть сотрудники с ролями менеджер/сотрудник/просмотр. Не обещай изменить роль, лимит или состав команды от имени администратора — это делает владелец в разделе «Команда». Финансовые вопросы и управление командой доступны только владельцу; сотруднику предложи обратиться к владельцу.
13. Проверка GTIN в «Проверке GTIN» показывает наличие карточки в открытом Национальном каталоге; если карточка не найдена — не утверждай, что её точно нет, предложи проверить GTIN и официальную процедуру.

Верни строго JSON без markdown:
{"diagnosis":"1–3 предложения","steps":["шаг 1","шаг 2"],"reply":"готовый ответ клиенту","actions":["unlock_login"],"needHuman":true|false}`;

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
  // AI-помощник доступен на всех тарифах (FREE/START — базовый лимит вопросов в день)
  return Boolean(user && user.id);
}

function chatLimitFor(user) {
  const plan = planOf(user);
  if (user.role === 'admin' || user.role === 'support') return { limit: LIMIT_CHAT_PER_HOUR, window: 3600 };
  if (plan.id === 'free' || plan.id === 'start') return { limit: 10, window: 86400 };
  return { limit: LIMIT_CHAT_PER_HOUR, window: 3600 };
}

/** Разделы кабинета: по ним помощник понимает, где сейчас клиент. */
const PAGES = {
  overview: { label: 'Обзор', keywords: 'обзор кабинет лимиты тариф статистика остатки' },
  history: { label: 'История', keywords: 'история заданий скачать выгрузка архив срок хранения' },
  generate: { label: 'Генерация', keywords: 'генерация коды csv xlsx загрузка gtIN datamatrix' },
  labels: { label: 'Этикетки', keywords: 'этикетки редактор шаблон макет размер dpi элементы datamatrix ean-13 штрихкод печать pdf принтер масштаб' },
  sets: { label: 'Наборы', keywords: 'наборы набор кин комплект компоненты шаблон набора упаковка' },
  reprint: { label: 'Повторная печать', keywords: 'повторная печать перепечатать ean-13 ean13 штрихкод ozon озон wildberries вайлдберриз карточка товара честный знак фото дата изготовления годен до криптозащита статус результаты проверки' },
  billing: { label: 'Подписка', keywords: 'подписка тариф premium цены период продление промокод скидка архив 3 года оплата чек возврат тестовый тариф' },
  api: { label: 'API', keywords: 'api ключ x-api-key интеграция лимиты разработчик генерация jobs me 401 403 429 документация' },
  apikeys: { label: 'API', keywords: 'api ключ x-api-key интеграция лимиты разработчик генерация jobs me 401 403 429 документация' },
  cz: { label: 'Честный ЗНАК', keywords: 'честный знак проверка кодов маркировка киз 91 92 93 криптозащита криптохвост статус в обороте не найден токен true api' },
  reviews: { label: 'Отзывы', keywords: 'отзывы отзыв рейтинг оценка мнение' },
  security: { label: 'Безопасность', keywords: 'безопасность 2fa двухфакторная пароль сессии вход восстановление фишинг данные' },
  team: { label: 'Команда', keywords: 'команда сотрудники приглашение роль менеджер оператор просмотр места доступ лимит сотрудника' },
  gtin: { label: 'Проверка GTIN', keywords: 'gtin карточка товара национальный каталог проверить карточку список gtин проверка перед кодами' },
  assistant: { label: 'AI-помощник', keywords: 'ai помощник ии как пользоваться лимит вопросов передать в поддержку' },
  help: { label: 'Помощь', keywords: 'помощь справка инструкции подсказки печать с телефона' }
};

const safeParse = (value) => {
  try { return JSON.parse(value); } catch { return null; }
};

/** Ответ мог прийти «почти-JSON» с обрывом по лимиту токенов — вытаскиваем текст. */
function cleanAnswer(text) {
  let s = String(text || '').trim();
  if (!/^\{\s*"/.test(s)) return s.slice(0, 3000);
  const m = /"answer"\s*:\s*"([\s\S]*)$/.exec(s);
  if (!m) return s.slice(0, 3000);
  s = m[1]
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
  const cut = s.search(/"\s*,\s*"(clarify|needHuman|reason|sources)"\s*:/);
  if (cut > 0) s = s.slice(0, cut);
  return s.replace(/["}\]]+\s*$/, '').trim().slice(0, 3000);
}

/** Компактные факты аккаунта: помогают отвечать по конкретной ситуации клиента. */
function clientFacts(userId) {
  try {
    const ctx = buildAiContext(userId);
    if (!ctx) return '';
    const lines = [];
    lines.push(ctx.subscription
      ? `Подписка: ${ctx.subscription.plan} до ${ctx.subscription.expires_at}.`
      : 'Активной подписки нет.');
    lines.push(`Использовано сегодня: ${ctx.usageToday} кодов (лимит ${ctx.planLimits.codesPerDay}).`);
    if (ctx.user.blockedAt) lines.push(`Аккаунт заблокирован: ${ctx.user.blockedReason || 'причина не указана'}.`);
    lines.push(`2FA: ${ctx.user.twoFactorEnabled ? 'включена' : 'выключена'}; требуется смена пароля: ${ctx.user.mustChangePassword ? 'да' : 'нет'}.`);
    if (ctx.loginLock.locked) lines.push(`Вход временно заблокирован до ${ctx.loginLock.lockedUntil} (неудачных попыток: ${ctx.loginLock.fails}).`);
    const jobs = ctx.jobs.recent.slice(0, 3).map((j) => `#${j.id} ${j.status}${j.error ? ' — ' + String(j.error).slice(0, 70) : ''}`);
    if (jobs.length) lines.push(`Последние задания: ${jobs.join('; ')}.`);
    if (ctx.jobs.failedLast24h) lines.push(`Ошибок заданий за сутки: ${ctx.jobs.failedLast24h}.`);
    const logs = ctx.appLogs.slice(0, 3).map((l) => `${l.level}/${l.source} ${String(l.message || '').slice(0, 80)}`);
    if (logs.length) lines.push(`Журнал ошибок: ${logs.join(' | ')}.`);
    if (ctx.mailErrors.length) lines.push(`Ошибки почты: ${String(ctx.mailErrors[0].message || '').slice(0, 100)}.`);
    lines.push(`Активных сессий: ${ctx.sessions.length}; API-ключей: ${ctx.apiKeysCount}.`);
    return lines.join('\n').slice(0, 1200);
  } catch { return ''; }
}

const SYSTEM = `Ты — AI-помощник сервиса CODE QR PRO (маркировка «Честный ЗНАК», GS1 DataMatrix, печать этикеток). Помогаешь клиентам прямо в личном кабинете.
Клиент находится в разделе кабинета: {{PAGE}}.
Данные клиента: {{PLAN}}.
Факты аккаунта: {{FACTS}}.

Главное правило: РЕШАЙ проблему, а не переспрашивай. Дай конкретные шаги, что проверить и что сделать.
Уточняющий вопрос допустим РОВНО ОДИН раз и только если сообщение клиента — одно-два слова без контекста («не работает», «помогите») и в диалоге ещё не было ответов. Если клиент уже что-то уточнил, если это продолжение диалога или вопрос понятен — сразу отвечай по делу, без вопросов. Никогда не задавай второй уточняющий вопрос подряд.

Правила:
1. Отвечай по-русски, по делу: 2–3 вероятные причины, затем шаги (до 7), затем что делать, если не помогло. Без markdown-заголовков. Весь ответ — до 900 символов.
2. Опирайся на статьи базы знаний ниже. Если в базе нет точного ответа — дай общий безопасный совет и предложи поддержку.
3. Финансы (оплата, скидки, возвраты, счета) не решай: вежливо объясни, что это решает поддержка, и предложи передать обращение.
4. Не проси пароль, коды 2FA, API-ключи и не советуй передавать их кому-либо.
5. Не обещай действий от имени администратора: если нужен доступ к аккаунту, сброс 2FA, разблокировка или вопрос про деньги — предложи «Передать в поддержку».
6. Если не уверен — предложи поддержку, но не спрашивай одно и то же повторно.
7. Называй точные разделы и кнопки кабинета («Генерация», «Этикетки», «Повторная печать», «Подписка», «История», «API», «Честный ЗНАК», «Безопасность»), чтобы клиент сразу нашёл нужное.
8. Учитывай новые возможности: карточка товара из «Честного ЗНАКа» и фото товара в «Повторной печати», EAN-13 для OZON и Wildberries, режимы результатов «Основная/Все поля/Компактная», статус кода и криптозащита, печать с телефона (AirPrint/Mopria).
9. Если вопрос про лимиты — используй данные клиента выше (тариф и остаток на сегодня), не выдумывай цифры.
10. Если проблема связана с аккаунтом (вход, лимиты, задания, почта, оплата), используй «Факты аккаунта»: назови конкретную причину, если она видна (например, задание #123 с ошибкой или блокировка входа), и предложи следующий шаг.
11. Покрывай проблему целиком: сначала самое вероятное решение, затем альтернативы и крайний шаг — «Передать в поддержку».
12. Учитывай командный доступ: у аккаунта могут быть сотрудники с ролями менеджер/сотрудник/просмотр. Не обещай изменить роль, лимит или состав команды от имени администратора — это делает владелец в разделе «Команда». Финансовые вопросы и управление командой доступны только владельцу; сотруднику предложи обратиться к владельцу.
13. Проверка GTIN в «Проверке GTIN» показывает наличие карточки в открытом Национальном каталоге; если карточка не найдена — не утверждай, что её точно нет, предложи проверить GTIN и официальную процедуру.

Верни строго JSON без markdown:
{"answer":"ответ по шагам или (только один раз) уточняющий вопрос","clarify":true|false,"needHuman":true|false,"reason":"почему нужен человек (коротко)","sources":["заголовки статей"]}`;

export async function registerAiSupportRoutes(app) {
  app.post('/api/assistant/chat', { preHandler: requireAuth }, async (req, reply) => {
    const cfg = aiConfig();
    if (!cfg.enabled) return reply.code(400).send({ error: 'Помощник временно недоступен. Напишите в поддержку.' });
    if (!aiConfigured(cfg)) return reply.code(400).send({ error: 'Помощник временно недоступен. Напишите в поддержку.' });

    const user = req.user;
    if (!supportAccess(user)) return reply.code(403).send({ error: 'AI-помощник недоступен для этого аккаунта.' });

    const message = String(req.body?.message || '').trim().slice(0, 1500);
    if (message.length < 3) return reply.code(400).send({ error: 'Опишите вопрос подробнее' });
    const pageKey = Object.prototype.hasOwnProperty.call(PAGES, String(req.body?.page || '')) ? String(req.body.page) : 'overview';
    const page = PAGES[pageKey];
    const plan = planOf(user);
    const facts = clientFacts(user.id);
    const planLine = [
      `тариф ${plan.title}`,
      `коды в день: ${plan.codesPerDay}`,
      `использовано сегодня: ${usageToday(user.id)}`,
      `пакет до ${plan.batchMax} строк`,
      `форматы: ${(plan.formats || []).join('/')}`,
      `история: ${plan.historyDays} дн.`,
      `архив: ${Math.round((plan.archiveMb || 0) / 1024 * 10) / 10} ГБ`,
      `API: ${plan.apiAccess ? 'да' : 'нет'}`,
      `редактор этикеток: ${plan.labelEditor ? 'да' : 'нет'}`
    ].join(', ');
    // история диалога: чтобы помощник отвечал на уточнения, а не переспрашивал по кругу
    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-8)
        .map((m) => ({ role: m?.role === 'assistant' ? 'ассистент' : 'клиент', text: String(m?.text || '').trim().slice(0, 600) }))
        .filter((m) => m.text)
      : [];
    const hadDialogue = history.some((m) => m.role === 'ассистент');

    const chatLimit = chatLimitFor(user);
    const limit = bumpLimit(`ai-support:${chatLimit.window === 86400 ? 'day' : 'hour'}:u${user.id}`, chatLimit.limit, chatLimit.window);
    if (!limit.ok) {
      return reply.code(429).send({
        error: chatLimit.window === 86400
          ? 'Базовый лимит AI-помощника: 10 вопросов в день. Лимит обновится завтра — или подключите PRO для расширенного доступа.'
          : 'Слишком много вопросов подряд. Подождите немного или передайте обращение в поддержку.'
      });
    }

    // ищем по вопросу, добавляя ключевые слова текущего раздела — ответ будет про то меню, где клиент
    let articles = searchKnowledge(`${message} ${page.keywords}`, 6);
    if (!articles.length) articles = searchKnowledge(`ошибка не работает ${page.keywords}`, 3);
    const context = kbContext(articles, 3600);
    const started = Date.now();
    let answer = '';
    let clarify = false;
    let needHuman = false;
    let reason = '';
    let model = cfg.model;
    let error = '';

    const askPrompt = (extra) => [
      history.length ? `Предыдущий диалог:\n${history.map((h) => `${h.role}: ${h.text}`).join('\n')}` : '',
      `Раздел: ${page.label}`,
      `Тариф и лимиты клиента: ${planLine}`,
      facts ? `Факты аккаунта:\n${facts}` : '',
      `Вопрос клиента: ${message}`,
      `База знаний:\n${context || '(подходящих статей не найдено)'}`,
      hadDialogue ? 'Это продолжение диалога: уточняющие вопросы ЗАПРЕЩЕНЫ, отвечай конкретными шагами.' : '',
      extra || ''
    ].filter(Boolean).join('\n\n');

    const runAsk = async (extra) => {
      const res = await askAi({
        system: SYSTEM.replace('{{PAGE}}', page.label).replace('{{PLAN}}', planLine).replace('{{FACTS}}', facts || 'нет данных'),
        user: askPrompt(extra),
        cfg,
        freeMaxTokens: 1400
      });
      const parsed = res.parsed || {};
      return {
        model: String(res.model || cfg.model).slice(0, 120),
        answer: cleanAnswer(parsed.answer || res.content || ''),
        clarify: Boolean(parsed.clarify),
        needHuman: Boolean(parsed.needHuman),
        reason: String(parsed.reason || '').slice(0, 300)
      };
    };

    try {
      let result = await runAsk();
      // второй уточняющий вопрос подряд недопустим — просим модель дать решение
      if (result.clarify && hadDialogue) {
        result = await runAsk('Ответь без уточняющих вопросов: дай конкретные шаги решения.');
        result.clarify = false;
      }
      // Короткий обрыв (модель остановилась на полуслове) — просим полный ответ один раз
      if (!result.clarify && result.answer.length < 120) {
        const retry = await runAsk('Ответ был слишком коротким или обрезанным. Дай полный ответ на 3–6 предложений: конкретные шаги и, если вопрос про лимиты, точные цифры тарифа.');
        if (retry.answer && retry.answer.length > result.answer.length) {
          result = { ...retry, clarify: false };
        }
      }
      model = result.model;
      answer = result.answer;
      clarify = result.clarify;
      needHuman = result.needHuman;
      reason = result.reason;
      if (!answer) throw new Error('Пустой ответ помощника');
    } catch (e) {
      error = String(e?.message || e).slice(0, 300);
      logEvent({
        level: 'warn', source: 'support', event: 'client_ai_failed',
        message: `Клиентский AI: ${error}`, userId: user.id, ip: req.ip, method: 'USER', url: req.url,
        meta: { question: message.slice(0, 120), history: history.length }
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
      clarify,
      needHuman,
      reason,
      page: { key: pageKey, label: page.label },
      sources: articles.map((a) => ({ slug: a.slug, title: a.title })),
      model,
      durationMs,
      left: limit.left
    };
  });

  // Обращение в поддержку: клиент передаёт сложный вопрос человеку.
  app.post('/api/assistant/tickets', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.user;
    if (!supportAccess(user)) return reply.code(403).send({ error: 'Обращения в поддержку недоступны для этого аккаунта.' });
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
      level: 'info', source: 'support', event: 'ticket_created',
      message: `Обращение в поддержку #${info.lastInsertRowid} от ${user.email}`,
      userId: user.id, ip: req.ip, method: 'USER', url: req.url,
      meta: { subject: subject.slice(0, 120), ticketId: Number(info.lastInsertRowid) }
    });
    audit(req, 'support.ticket_create', 'support_ticket', Number(info.lastInsertRowid), { subject: subject.slice(0, 120) });

    // Уведомляем администратора: Telegram + живой счётчик в админке (см. /api/admin/tickets/count)
    notifySupportTicket(
      { id: Number(info.lastInsertRowid), subject, message },
      user,
      `${publicUrl()}/app/admin/support`
    );

    return { ok: true, id: Number(info.lastInsertRowid), status: 'open' };
  });

  // Быстрый счётчик для бейджа в админке (опрашивается раз в 30 секунд).
  app.get('/api/admin/tickets/count', { preHandler: requireAdmin }, async () => {
    const open = db.prepare("SELECT COUNT(*) c FROM support_tickets WHERE status = 'open'").get().c;
    const inProgress = db.prepare("SELECT COUNT(*) c FROM support_tickets WHERE status = 'in_progress'").get().c;
    const latest = db.prepare(
      "SELECT t.id, t.subject, t.created_at, u.email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.status = 'open' ORDER BY t.id DESC LIMIT 1"
    ).get();
    return { open, inProgress, latest: latest || null };
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

  // Отправить обращение AI-помощнику: он изучает тикет + факты аккаунта и предлагает решение.
  app.post('/api/admin/tickets/:id/ai', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const ticket = db.prepare(
      'SELECT id, user_id, subject, message, ai_context, status, created_at FROM support_tickets WHERE id = ?'
    ).get(id);
    if (!ticket) return reply.code(404).send({ error: 'Обращение не найдено' });

    const cfg = aiConfig();
    if (!cfg.enabled) return reply.code(400).send({ error: 'AI-помощник выключен. Включите его в «Настройки → AI-помощник».' });
    if (!aiConfigured(cfg)) return reply.code(400).send({ error: 'AI не настроен: добавьте ключ или установите DSH.' });

    const limit = bumpLimit(`ai-ticket-ai:u${req.user.id}`, 30);
    if (!limit.ok) return reply.code(429).send({ error: 'Лимит AI-запросов: 30 в час. Попробуйте позже.' });

    const ctx = buildAiContext(ticket.user_id);
    if (!ctx) return reply.code(404).send({ error: 'Клиент обращения не найден' });
    const client = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(ticket.user_id);

    const started = Date.now();
    let result = null;
    let error = '';
    let model = cfg.model;
    try {
      const facts = formatAiContext(ctx);
      const res = await askAi({
        system: SUPPORT_SOLVER_SYSTEM,
        user: [
          `Обращение #${ticket.id} от ${client?.email || 'клиент'}${client?.name ? ' (' + client.name + ')' : ''}`,
          `Тема: ${ticket.subject}`,
          `Текст клиента: ${ticket.message}`,
          ticket.ai_context ? `Что ответил клиентский AI-помощник: ${ticket.ai_context}` : '',
          '',
          `Факты аккаунта:\n${facts.length > 1800 ? facts.slice(0, 1800) + '…' : facts}`
        ].filter(Boolean).join('\n'),
        cfg,
        freeMaxTokens: 1200
      });
      model = String(res.model || cfg.model).slice(0, 120);
      const parsed = res.parsed || {};
      const actions = (Array.isArray(parsed.actions) ? parsed.actions : []).filter((a) => SUPPORT_ACTIONS.includes(a)).slice(0, 5);
      const steps = (Array.isArray(parsed.steps) ? parsed.steps : []).slice(0, 6).map((s) => String(s).slice(0, 400));
      const diagnosis = String(parsed.diagnosis || (res.parsed ? '' : res.content) || '').slice(0, 1500);
      let reply = String(parsed.reply || parsed.draft || '').slice(0, 3000);
      if (!reply) {
        // модель иногда пропускает поле reply — собираем ответ из диагноза и шагов
        const parts = [];
        if (diagnosis) parts.push(`Здравствуйте! ${diagnosis}`);
        if (steps.length) parts.push('Что мы делаем: ' + steps.map((s, i) => `${i + 1}) ${s}`).join(' '));
        parts.push('Если вопрос остаётся — ответьте на это сообщение, и мы продолжим разбор.');
        reply = parts.join('\n\n').slice(0, 3000);
      }
      result = {
        diagnosis,
        steps,
        reply,
        actions,
        needHuman: Boolean(parsed.needHuman)
      };
      if (!result.diagnosis && !result.reply) throw new Error('AI не вернул решение');
    } catch (e) {
      error = String(e?.message || e).slice(0, 400);
      logEvent({
        level: 'warn', source: 'ai', event: 'ticket_ai_failed',
        message: `AI по обращению #${id}: ${error}`,
        userId: ticket.user_id, ip: req.ip, method: 'ADMIN', url: req.url, meta: { ticketId: id }
      });
    }

    const durationMs = Date.now() - started;
    db.prepare(
      'INSERT INTO ai_queries (user_id, admin_id, question, answer, actions, model, backend, status, error, duration_ms, via) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      ticket.user_id, req.user.id, `Обращение #${id}: ${String(ticket.subject).slice(0, 160)}`,
      JSON.stringify(result ? { diagnosis: result.diagnosis, steps: result.steps, draft: result.reply, confidence: 'medium' } : {}),
      JSON.stringify(result?.actions || []), model, cfg.backend, error ? 'error' : 'ok', error, durationMs, ''
    );
    audit(req, 'support.ticket_ai', 'support_ticket', id, { status: error ? 'error' : 'ok', model, durationMs });

    if (error) return reply.code(502).send({ error, ticketId: id });
    return { ok: true, ticketId: id, ...result, model, backend: cfg.backend, durationMs };
  });

  // --- база знаний: публичные статьи (без черновиков) ---
  app.get('/api/public/articles', async () => ({ articles: listPublicKbArticles() }));

  app.get('/api/public/articles/:slug', async (req, reply) => {
    const article = getPublicKbArticle(req.params.slug);
    if (!article) return reply.code(404).send({ error: 'Статья не найдена' });
    return { article };
  });

  // --- sitemap: публичные страницы + статьи ---
  app.get('/sitemap.xml', async (req, reply) => {
    const base = String(process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru').replace(/\/+$/, '');
    const staticPages = ['', '/check', '/pricing', '/articles', '/faq', '/offer', '/terms', '/privacy'];
    const entries = [
      ...staticPages.map((p) => ({ loc: base + (p || '/'), lastmod: new Date().toISOString().slice(0, 10) })),
      ...listPublicKbArticles().map((a) => ({ loc: base + '/articles/' + encodeURIComponent(a.slug), lastmod: String(a.updated_at || '').slice(0, 10) }))
    ];
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      entries.map((e) => '  <url><loc>' + e.loc.replace(/&/g, '&amp;') + '</loc>' + (e.lastmod ? '<lastmod>' + e.lastmod + '</lastmod>' : '') + '</url>').join('\n') +
      '\n</urlset>';
    return reply.type('application/xml').send(xml);
  });

  // --- база знаний: просмотр для админа ---
  app.get('/api/admin/kb', { preHandler: requireAdmin }, async () => ({ articles: listKbArticles() }));

  app.get('/api/admin/kb/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const row = db.prepare('SELECT * FROM kb_articles WHERE id=?').get(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: 'Статья не найдена' });
    return { article: row };
  });

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
