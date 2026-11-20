import { db } from '../db.js';
import { audit } from './audit.js';
import { requireAdmin } from './admin.js';

/**
 * Журнал приложения: серверные и клиентские ошибки + медленные запросы.
 * Пишется в БД, чтобы админ видел проблемы без SSH. Глубокий разбор —
 * по-прежнему journalctl (pino выводит всё в stdout).
 *
 * Правила: не логируем cookie/токены/пароли, обрезаем длинные строки,
 * храним 30 дней и не больше 20 000 записей.
 */

const MAX_MESSAGE = 2000;
const MAX_STACK = 5000;
const MAX_META = 2000;
const KEEP_DAYS = 30;
const KEEP_ROWS = 20000;

const cut = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);

export function pathOf(url) {
  const raw = String(url || '');
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

export function logEvent(entry = {}) {
  try {
    const level = ['error', 'warn', 'info'].includes(entry.level) ? entry.level : 'error';
    let meta = '';
    if (entry.meta != null) {
      try { meta = JSON.stringify(entry.meta).slice(0, MAX_META); } catch { meta = ''; }
    }
    db.prepare(`INSERT INTO app_logs
      (level, source, event, message, stack, method, url, status, user_id, ip, request_id, meta, user_agent)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      level,
      cut(entry.source || 'server', 20),
      cut(entry.event || '', 60),
      cut(entry.message || '', MAX_MESSAGE),
      cut(entry.stack || '', MAX_STACK),
      cut(entry.method || '', 10),
      cut(pathOf(entry.url), 300),
      Number(entry.status) || 0,
      entry.userId ?? null,
      cut(entry.ip || '', 60),
      cut(entry.requestId || '', 60),
      meta,
      cut(entry.userAgent || '', 200)
    );
    return true;
  } catch (e) {
    try { console.error('app-log write failed:', e?.message || e); } catch { /* noop */ }
    return false;
  }
}

export function pruneAppLogs({ days = KEEP_DAYS, keepRows = KEEP_ROWS } = {}) {
  let removed = 0;
  try {
    removed += db.prepare("DELETE FROM app_logs WHERE created_at < datetime('now', ?)").run(`-${Number(days)} days`).changes;
    removed += db.prepare(
      `DELETE FROM app_logs WHERE id NOT IN (SELECT id FROM app_logs ORDER BY id DESC LIMIT ?)`
    ).run(Number(keepRows)).changes;
  } catch { /* ignore */ }
  return removed;
}

/** Ошибки, которые не дошли до HTTP-ответа: падения процесса. */
export function installProcessLogHandlers() {
  process.on('uncaughtException', (error) => {
    try { console.error('uncaughtException', error); } catch { /* noop */ }
    logEvent({ level: 'error', source: 'process', event: 'uncaught_exception', message: error?.message || String(error), stack: error?.stack });
  });
  process.on('unhandledRejection', (reason) => {
    try { console.error('unhandledRejection', reason); } catch { /* noop */ }
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logEvent({ level: 'error', source: 'process', event: 'unhandled_rejection', message: error.message, stack: error.stack });
  });
}

/** Хуки Fastify: ошибки 5xx, ответы 5xx без исключения и медленные запросы. */
export function installAppLogHooks(app, { slowMs = 5000 } = {}) {
  app.addHook('onError', async (request, reply, error) => {
    const code = String(error?.code || '');
    // Некорректный запрос клиента и протухшие ассеты — не ошибки сервера:
    // на них есть понятные ответы (415/400/404), журнал ими не засоряем.
    if (/^FST_ERR_CTP_/.test(code)) return;
    if (String(request.raw?.url || '').startsWith('/assets/') && (code === 'EACCES' || code === 'ENOENT')) return;
    request.__appLogged = true;
    logEvent({
      level: 'error',
      source: 'server',
      event: error?.code || 'request_error',
      message: error?.message || 'Неизвестная ошибка',
      stack: error?.stack,
      method: request.method,
      url: request.url,
      status: reply.statusCode >= 400 ? reply.statusCode : 500,
      userId: request.user?.id ?? null,
      ip: request.ip,
      requestId: request.id,
      userAgent: request.headers['user-agent'],
      meta: { route: request.routeOptions?.url || '' }
    });
  });

  app.addHook('onResponse', async (request, reply) => {
    const status = reply.statusCode;
    if (status >= 500 && !request.__appLogged) {
      request.__appLogged = true;
      logEvent({
        level: 'error',
        source: 'server',
        event: 'http_5xx',
        message: `HTTP ${status} на ${request.method} ${pathOf(request.url)}`,
        method: request.method,
        url: request.url,
        status,
        userId: request.user?.id ?? null,
        ip: request.ip,
        requestId: request.id,
        userAgent: request.headers['user-agent'],
        meta: { route: request.routeOptions?.url || '' }
      });
      return;
    }
    const elapsed = Number(reply.elapsedTime || 0);
    // AI-разборы и выгрузки по своей природе долгие — не засоряем журнал «медленными запросами».
    const path = pathOf(request.url);
    if (path.startsWith('/api/admin/ai/') || path.startsWith('/api/assistant/')) return;
    if (status < 400 && elapsed >= slowMs) {
      logEvent({
        level: 'warn',
        source: 'server',
        event: 'slow_request',
        message: `Медленный запрос: ${request.method} ${pathOf(request.url)} — ${Math.round(elapsed)} мс`,
        method: request.method,
        url: request.url,
        status,
        userId: request.user?.id ?? null,
        ip: request.ip,
        requestId: request.id,
        meta: { elapsedMs: Math.round(elapsed), route: request.routeOptions?.url || '' }
      });
    }
  });
}

const clientHits = new Map();
function clientRateOk(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const hit = clientHits.get(key);
  if (!hit || now > hit.reset) {
    clientHits.set(key, { n: 1, reset: now + 60_000 });
    return true;
  }
  hit.n += 1;
  return hit.n <= 30;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, hit] of clientHits) if (now > hit.reset) clientHits.delete(key);
}, 60_000).unref();

const LOG_SELECT = 'id, level, source, event, message, stack, method, url, status, user_id, ip, request_id, meta, user_agent, created_at';

export async function registerLogRoutes(app) {
  // Клиентские ошибки: ловим падения во фронтенде, чтобы видеть проблемы
  // пользователей, которые не попадают в серверные логи.
  app.post('/api/logs/client', async (req, reply) => {
    if (!clientRateOk(req.ip)) return reply.code(429).send({ error: 'Слишком много сообщений' });
    const body = req.body || {};
    const message = cut(body.message || 'Клиентская ошибка', 1000);
    logEvent({
      level: body.level === 'warn' ? 'warn' : 'error',
      source: 'client',
      event: cut(body.event || 'client_error', 60),
      message,
      stack: cut(body.stack || '', MAX_STACK),
      method: 'CLIENT',
      url: cut(body.url || '', 300),
      status: 0,
      userId: req.user?.id ?? null,
      ip: req.ip,
      requestId: cut(body.requestId || '', 60),
      userAgent: req.headers['user-agent'],
      meta: { route: cut(body.route || '', 120), app: cut(body.app || '', 40), line: cut(body.line || '', 40) }
    });
    return { ok: true };
  });

  app.get('/api/admin/logs', { preHandler: requireAdmin }, async (req) => {
    const page = Math.max(1, Number(req.query?.page) || 1);
    const per = Math.min(100, Math.max(10, Number(req.query?.per) || 30));
    const where = [];
    const params = [];
    const level = String(req.query?.level || '');
    if (['error', 'warn', 'info'].includes(level)) { where.push('level = ?'); params.push(level); }
    const source = String(req.query?.source || '');
    if (['server', 'client', 'process'].includes(source)) { where.push('source = ?'); params.push(source); }
    const q = String(req.query?.q || '').trim().slice(0, 120);
    if (q) {
      where.push("(message LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR event LIKE ? ESCAPE '\\')");
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      params.push(like, like, like);
    }
    const days = Math.min(90, Math.max(1, Number(req.query?.days) || 7));
    where.push("created_at >= datetime('now', ?)");
    params.push(`-${days} days`);
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(`SELECT ${LOG_SELECT} FROM app_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, per, (page - 1) * per);
    const total = db.prepare(`SELECT COUNT(*) c FROM app_logs ${whereSql}`).get(...params).c;
    const byLevel = db.prepare(
      "SELECT level, COUNT(*) c FROM app_logs WHERE created_at >= datetime('now', ?) GROUP BY level"
    ).all(`-${days} days`);
    return {
      logs: rows,
      total,
      page,
      per,
      pages: Math.max(1, Math.ceil(total / per)),
      counts: Object.fromEntries(byLevel.map((r) => [r.level, r.c]))
    };
  });

  app.get('/api/admin/logs/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const row = db.prepare(`SELECT ${LOG_SELECT} FROM app_logs WHERE id=?`).get(Number(req.params.id) || 0);
    if (!row) return reply.code(404).send({ error: 'Запись не найдена' });
    return { log: row };
  });

  app.delete('/api/admin/logs', { preHandler: requireAdmin }, async (req, reply) => {
    const days = Math.min(365, Math.max(1, Number(req.body?.days || req.query?.days) || 30));
    const r = db.prepare("DELETE FROM app_logs WHERE created_at < datetime('now', ?)").run(`-${days} days`);
    audit(req, 'logs.clear', 'app_logs', '', { days, removed: r.changes });
    return { ok: true, removed: r.changes };
  });

  app.get('/api/admin/logs/export.csv', { preHandler: requireAdmin }, async (req, reply) => {
    const days = Math.min(90, Math.max(1, Number(req.query?.days) || 7));
    const rows = db.prepare(`SELECT ${LOG_SELECT} FROM app_logs WHERE created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 5000`)
      .all(`-${days} days`);
    audit(req, 'logs.export', 'app_logs', '', { days, rows: rows.length });
    const header = ['ID', 'Время', 'Уровень', 'Источник', 'Событие', 'Сообщение', 'Метод', 'URL', 'Статус', 'Пользователь', 'IP', 'Request ID'];
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = [header, ...rows.map((r) => [r.id, r.created_at, r.level, r.source, r.event, r.message, r.method, r.url, r.status, r.user_id ?? '', r.ip, r.request_id])]
      .map((line) => line.map(esc).join(';')).join('\r\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="app-logs.csv"');
    return reply.send('\uFEFF' + csv);
  });
}
