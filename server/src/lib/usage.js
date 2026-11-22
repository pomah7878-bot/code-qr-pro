import { db } from '../db.js';
import { currentPeriod, ensureUsagePeriod } from './subscription.js';

/**
 * UsageMeter: раздельный учёт операций и расширенных проверок.
 * Требования ТЗ: идемпотентность, суточный лимит FREE, не списывать при ошибках,
 * не списывать повторно при повторном нажатии/повторном запросе.
 */

export class UsageError extends Error {
  constructor(message, { kind = 'ops', needed = 0, left = 0, limit = 0, dailyLeft = null, dailyLimit = 0, resetAt = null, code = 'limit_reached', statusCode = 402 } = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.payload = { code, kind, needed, left, limit, dailyLeft, dailyLimit, resetAt };
  }
}

const clampCount = (n) => Math.max(1, Math.min(100000, Math.round(Number(n) || 1)));
const kindColumn = (kind) => ({ check: 'checks_used', export: 'exports_used', api: 'api_calls_used' }[kind] || 'ops_used');
const dailyColumn = (kind) => (kind === 'check' ? 'checks_used' : 'ops_used');
const limitFor = (period, kind) => Number(kind === 'check' ? period.checksLimit : kind === 'export' ? period.exportsLimit : kind === 'api' ? period.apiLimit : period.opsLimit) || 0;

function findEvent(userId, idemKey) {
  if (!idemKey) return null;
  return db.prepare('SELECT * FROM usage_events WHERE user_id=? AND idem_key=?').get(userId, String(idemKey).slice(0, 120)) || null;
}

function capacity(user, kind, count) {
  const period = currentPeriod(user);
  const row = ensureUsagePeriod(user, period);
  const used = Number(row[kindColumn(kind)]) || 0;
  const limit = limitFor(period, kind);
  const left = Math.max(0, limit - used);
  let dailyLeft = null;
  let dailyLimit = 0;
  if (kind === 'operation' && Number(period.dailyLimit) > 0) {
    dailyLimit = Number(period.dailyLimit);
    const daily = db.prepare('SELECT ops_used FROM usage_daily WHERE user_id=? AND day=date(\'now\')').get(user.id);
    dailyLeft = Math.max(0, dailyLimit - (Number(daily?.ops_used) || 0));
  }
  return { period, row, used, limit, left, dailyLeft, dailyLimit };
}

/** Предварительная проверка без списания (для UI и внешних вызовов). */
export function checkAvailability(user, kind = 'operation', count = 1) {
  const n = clampCount(count);
  const c = capacity(user, kind, n);
  const enough = c.left >= n && (c.dailyLeft === null || c.dailyLeft >= n);
  return {
    ok: enough,
    kind,
    needed: n,
    left: c.left,
    limit: c.limit,
    dailyLeft: c.dailyLeft,
    dailyLimit: c.dailyLimit,
    resetAt: c.period.periodEnd || null,
    source: c.period.source,
    planId: c.period.planId
  };
}

/**
 * Списать операции/проверки. Возвращает {ok, duplicated, left, limit, period}.
 * При нехватке лимита бросает UsageError (HTTP 402).
 */
export function consume(user, kind = 'operation', count = 1, { idemKey = '', context = '', external = kind === 'check' } = {}) {
  const n = clampCount(count);
  const key = idemKey ? String(idemKey).slice(0, 120) : null;
  const duplicate = findEvent(user.id, key);
  if (duplicate) {
    const c = capacity(user, kind, n);
    return { ok: true, duplicated: true, kind, count: n, left: c.left, limit: c.limit, period: c.period };
  }
  const c = capacity(user, kind, n);
  if (c.left < n) {
    throw new UsageError(
      kind === 'check'
        ? `Закончились расширенные проверки: осталось ${c.left} из ${c.limit}. Проверки обновятся ${c.period.periodEnd ? String(c.period.periodEnd).slice(0, 10) : 'в новом периоде'}.`
        : kind === 'export'
          ? `Закончился лимит экспорта: осталось ${c.left} из ${c.limit}. Лимит обновится ${c.period.periodEnd ? String(c.period.periodEnd).slice(0, 10) : 'в новом периоде'}.`
          : kind === 'api'
            ? `Закончился лимит API: осталось ${c.left} из ${c.limit}. Лимит обновится ${c.period.periodEnd ? String(c.period.periodEnd).slice(0, 10) : 'в новом периоде'}.`
            : `Закончились операции: осталось ${c.left} из ${c.limit}. Лимит обновится ${c.period.periodEnd ? String(c.period.periodEnd).slice(0, 10) : 'в новом периоде'}.`,
      { kind, needed: n, left: c.left, limit: c.limit, dailyLeft: c.dailyLeft, dailyLimit: c.dailyLimit, resetAt: c.period.periodEnd, code: kind === 'check' ? 'checks_limit' : kind === 'export' ? 'exports_limit' : kind === 'api' ? 'api_limit' : 'ops_limit' }
    );
  }
  if (c.dailyLeft !== null && c.dailyLeft < n) {
    throw new UsageError(
      `Дневной лимит: осталось ${c.dailyLeft} из ${c.dailyLimit} операций. Суточный лимит обновится в 00:00 UTC.`,
      { kind, needed: n, left: c.left, limit: c.limit, dailyLeft: c.dailyLeft, dailyLimit: c.dailyLimit, resetAt: c.period.periodEnd, code: 'daily_limit' }
    );
  }

  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO usage_events (user_id, period_id, kind, count, context, idem_key, external)
         VALUES (?,?,?,?,?,?,?)`
      ).run(user.id, c.row.id, kind, n, String(context || '').slice(0, 200), key, external ? 1 : 0);
      db.prepare(
        `UPDATE usage_periods SET ${kindColumn(kind)} = ${kindColumn(kind)} + ?, updated_at=datetime('now') WHERE id=?`
      ).run(n, c.row.id);
      if (kind === 'operation' || kind === 'check') {
        db.prepare(
          `INSERT INTO usage_daily (user_id, day, codes_generated, ${dailyColumn(kind)})
           VALUES (?, date('now'), 0, ?)
           ON CONFLICT(user_id, day) DO UPDATE SET ${dailyColumn(kind)} = ${dailyColumn(kind)} + excluded.${dailyColumn(kind)}`
        ).run(user.id, n);
      }
    })();
  } catch (e) {
    // гонка по idempotency key: другой запрос уже списал — не списываем повторно
    if (/UNIQUE/i.test(String(e?.message || ''))) {
      const again = capacity(user, kind, n);
      return { ok: true, duplicated: true, kind, count: n, left: again.left, limit: again.limit, period: again.period };
    }
    throw e;
  }

  const after = capacity(user, kind, n);
  return {
    ok: true,
    duplicated: false,
    kind,
    count: n,
    left: after.left,
    limit: after.limit,
    dailyLeft: after.dailyLeft,
    dailyLimit: after.dailyLimit,
    period: after.period
  };
}

export const consumeOperations = (user, count = 1, opts = {}) => consume(user, 'operation', count, opts);
export const consumeChecks = (user, count = 1, opts = {}) => consume(user, 'check', count, opts);
export const consumeExports = (user, count = 1, opts = {}) => consume(user, 'export', count, opts);
export const consumeApiCalls = (user, count = 1, opts = {}) => consume(user, 'api', count, opts);

/** Журнал внешних запросов (стоимость/ошибки интеграций). */
export function recordExternalRequest({ userId = null, adapter = '', ok = false, statusCode = 0, latencyMs = 0, error = '', costUnits = 1 } = {}) {
  try {
    db.prepare(
      'INSERT INTO external_requests (user_id, adapter, ok, status_code, latency_ms, error, cost_units) VALUES (?,?,?,?,?,?,?)'
    ).run(userId || null, String(adapter).slice(0, 60), ok ? 1 : 0, Number(statusCode) || 0, Math.round(Number(latencyMs) || 0), String(error || '').slice(0, 300), Math.max(0, Math.round(Number(costUnits) || 0)));
  } catch { /* журнал не должен ломать запрос */ }
}

/** Неуспешный внешний запрос: лимит не списываем, но фиксируем для админки. */
export function recordFailedExternal({ userId, adapter, statusCode = 0, error = '', latencyMs = 0 }) {
  recordExternalRequest({ userId, adapter, ok: false, statusCode, error, latencyMs, costUnits: 0 });
}

export function todayUsage(userId) {
  return db.prepare("SELECT ops_used, checks_used, codes_generated FROM usage_daily WHERE user_id=? AND day=date('now')")
    .get(userId) || { ops_used: 0, checks_used: 0, codes_generated: 0 };
}
