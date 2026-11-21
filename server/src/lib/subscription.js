import { db } from '../db.js';
import { recordConversion } from './analytics.js';
import { getPlan, planOf, normalizePlanId } from '../plans.js';
import { getSetting } from '../settings.js';
import { notifyStatusChange } from '../notify.js';
import { notifyClient } from './client-mail.js';

/**
 * Подписки и пробный период. Источник истины: users.plan + subscriptions + users.trial_*.
 * Использование лимитов живёт в usage.js и привязано к периоду из currentPeriod().
 */

const PAID_PLANS = new Set(['start', 'pro', 'business']);

const sqlNow = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19);
const asDate = (value) => {
  if (!value) return null;
  const s = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const addDays = (base, days) => new Date(base.getTime() + Math.max(0, Number(days) || 0) * 86400000);
const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
const nextMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));

export function activeSubscription(userId) {
  return db.prepare(
    "SELECT * FROM subscriptions WHERE user_id=? AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1"
  ).get(userId) || null;
}

export function latestSubscription(userId) {
  return db.prepare('SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId) || null;
}

export function trialInfo(user, now = new Date()) {
  const row = db.prepare('SELECT trial_started_at, trial_ends_at, trial_used FROM users WHERE id=?').get(user.id) || user;
  const ends = asDate(row?.trial_ends_at);
  const started = asDate(row?.trial_started_at);
  const active = Boolean(ends && ends.getTime() > now.getTime());
  return {
    used: Boolean(row?.trial_used),
    startedAt: started ? started.toISOString() : null,
    endsAt: ends ? ends.toISOString() : null,
    active,
    daysLeft: active ? Math.ceil((ends.getTime() - now.getTime()) / 86400000) : 0
  };
}

/** Действующий период использования и его лимиты. */
export function currentPeriod(user) {
  const now = new Date();
  const paid = activeSubscription(user.id);
  const subPlan = paid ? getPlan(paid.plan) : null;
  if (paid && subPlan) {
    return {
      source: 'subscription',
      plan: subPlan,
      planId: subPlan.id,
      periodStart: String(paid.started_at || sqlNow(now)),
      periodEnd: String(paid.expires_at || ''),
      opsLimit: Number(subPlan.opsPerPeriod) || 0,
      checksLimit: Number(subPlan.checksPerPeriod) || 0,
      dailyLimit: Number(subPlan.dailyOps) || 0,
      subscription: paid,
      trial: trialInfo(user, now)
    };
  }
  const trial = trialInfo(user, now);
  if (trial.active) {
    const pro = getPlan('pro');
    return {
      source: 'trial',
      plan: pro,
      planId: 'pro',
      periodStart: trial.startedAt,
      periodEnd: trial.endsAt,
      opsLimit: Number(pro.opsPerPeriod) || 0,
      checksLimit: Math.max(0, Number(getSetting('trial_checks', '50')) || 50),
      dailyLimit: 0,
      subscription: null,
      trial
    };
  }
  const free = getPlan('free');
  const start = monthStart(now);
  return {
    source: 'free',
    plan: free,
    planId: 'free',
    periodStart: sqlNow(start),
    periodEnd: sqlNow(nextMonth(now)),
    opsLimit: Number(free.opsPerPeriod) || 0,
    checksLimit: Number(free.checksPerPeriod) || 0,
    dailyLimit: Number(free.dailyOps) || 0,
    subscription: subPlan && paid ? paid : null,
    trial
  };
}

export function ensureUsagePeriod(user, period = currentPeriod(user)) {
  const existing = db.prepare('SELECT * FROM usage_periods WHERE user_id=? AND period_start=?').get(user.id, period.periodStart);
  if (existing) return existing;
  const info = db.prepare(
    'INSERT INTO usage_periods (user_id, plan, source, period_start, period_end) VALUES (?,?,?,?,?)'
  ).run(user.id, period.planId, period.source, period.periodStart, period.periodEnd || null);
  return db.prepare('SELECT * FROM usage_periods WHERE id=?').get(info.lastInsertRowid);
}

/** Текущее использование (для /api/me, кабинета и проверок лимитов). */
export function usageSummary(user, period = currentPeriod(user)) {
  const row = ensureUsagePeriod(user, period);
  const opsUsed = Number(row.ops_used) || 0;
  const checksUsed = Number(row.checks_used) || 0;
  const daily = db.prepare(
    "SELECT ops_used, checks_used FROM usage_daily WHERE user_id=? AND day=date('now')"
  ).get(user.id) || { ops_used: 0, checks_used: 0 };
  const opsLimit = Number(period.opsLimit) || 0;
  const checksLimit = Number(period.checksLimit) || 0;
  const dailyLimit = Number(period.dailyLimit) || 0;
  const opsLeft = opsLimit > 0 ? Math.max(0, opsLimit - opsUsed) : Infinity;
  const checksLeft = checksLimit > 0 ? Math.max(0, checksLimit - checksUsed) : 0;
  const dailyLeft = dailyLimit > 0 ? Math.max(0, dailyLimit - (Number(daily.ops_used) || 0)) : Infinity;
  const pct = (used, limit) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);
  return {
    source: period.source,
    planId: period.planId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    ops: { used: opsUsed, limit: opsLimit, left: Number.isFinite(opsLeft) ? opsLeft : null, percent: pct(opsUsed, opsLimit) },
    checks: { used: checksUsed, limit: checksLimit, left: checksLeft, percent: pct(checksUsed, checksLimit) },
    daily: { used: Number(daily.ops_used) || 0, limit: dailyLimit, left: Number.isFinite(dailyLeft) ? dailyLeft : null },
    trial: period.trial,
    subscription: period.subscription ? {
      id: period.subscription.id,
      plan: period.subscription.plan,
      expiresAt: period.subscription.expires_at,
      autoRenew: Boolean(period.subscription.auto_renew)
    } : null,
    warnings: {
      ops80: opsLimit > 0 && opsUsed >= opsLimit * 0.8,
      checks80: checksLimit > 0 && checksUsed >= checksLimit * 0.8,
      ops100: opsLimit > 0 && opsUsed >= opsLimit,
      checks100: checksLimit > 0 && checksUsed >= checksLimit
    }
  };
}

/** Полные права пользователя: тариф + период + использование. */
export function entitlements(user) {
  const period = currentPeriod(user);
  const summary = usageSummary(user, period);
  const plan = planOf(user);
  return {
    plan: {
      ...plan,
      source: period.source,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      subscription: summary.subscription,
      trial: summary.trial
    },
    usage: summary
  };
}

export class SubscriptionError extends Error {
  constructor(message, statusCode = 400, code = 'subscription_error') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Активация пробного периода PRO на 7 дней (один раз на аккаунт). */
export function startTrial(user) {
  const days = Math.max(1, Math.min(60, Number(getSetting('trial_days', '7')) || 7));
  const fresh = db.prepare('SELECT id, plan, trial_used, trial_ends_at FROM users WHERE id=?').get(user.id);
  if (!fresh) throw new SubscriptionError('Пользователь не найден', 404);
  if (fresh.trial_used) throw new SubscriptionError('Пробный период уже был использован', 409, 'trial_used');
  if (activeSubscription(user.id)) throw new SubscriptionError('У вас уже есть активная подписка', 409, 'has_subscription');
  const now = new Date();
  const ends = addDays(now, days);
  db.transaction(() => {
    db.prepare(
      "UPDATE users SET plan='pro', trial_started_at=?, trial_ends_at=?, trial_used=1 WHERE id=?"
    ).run(sqlNow(now), sqlNow(ends), user.id);
    db.prepare(
      'INSERT INTO usage_periods (user_id, plan, source, period_start, period_end) VALUES (?,?,?,?,?)'
    ).run(user.id, 'pro', 'trial', sqlNow(now), sqlNow(ends));
  })();
  recordConversion('trial', user.id);
  notifyStatusChange(user, `Активирован пробный период PRO на ${days} дней`);
  return { trial: trialInfo({ id: user.id }), plan: getPlan('pro'), days };
}

/**
 * Активация оплаченной подписки. Для продления того же тарифа — продлевает текущий период,
 * для смены тарифа/после триала — начинает новый период с текущего момента.
 */
export function activateSubscription({ userId, planId, days = 30, provider = 'yookassa', externalId = '', orderId = null, source = 'payment' }) {
  const id = normalizePlanId(planId);
  const plan = getPlan(id);
  if (!plan || !PAID_PLANS.has(plan.id)) throw new SubscriptionError('Неизвестный платный тариф', 400);
  const termDays = Math.max(1, Math.min(3660, Math.round(Number(days) || 30)));
  const now = new Date();
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw new SubscriptionError('Пользователь не найден', 404);

  const existing = activeSubscription(userId);
  const renewSame = existing && normalizePlanId(existing.plan) === id;
  let startedAt = now;
  let expiresAt = addDays(now, termDays);
  if (renewSame) {
    const currentEnd = asDate(existing.expires_at) || now;
    startedAt = asDate(existing.started_at) || now;
    expiresAt = addDays(currentEnd > now ? currentEnd : now, termDays);
  }

  db.transaction(() => {
    if (existing && !renewSame) {
      db.prepare("UPDATE subscriptions SET status='replaced', canceled_at=datetime('now') WHERE id=?").run(existing.id);
    }
    if (renewSame) {
      db.prepare("UPDATE subscriptions SET expires_at=?, plan_title=?, source=? WHERE id=?")
        .run(sqlNow(expiresAt), plan.title, source, existing.id);
    } else {
      db.prepare(`INSERT INTO subscriptions
        (user_id, plan, status, provider, external_id, started_at, expires_at, source, plan_title)
        VALUES (?,?, 'active', ?, ?, ?, ?, ?, ?)`)
        .run(userId, id, provider, externalId || null, sqlNow(startedAt), sqlNow(expiresAt), source, plan.title);
    }
    if (renewSame) {
      db.prepare('UPDATE usage_periods SET period_end=? WHERE user_id=? AND period_start=?')
        .run(sqlNow(expiresAt), userId, String(existing.started_at));
    } else {
      db.prepare('INSERT INTO usage_periods (user_id, plan, source, period_start, period_end) VALUES (?,?,?,?,?)')
        .run(userId, id, source, sqlNow(now), sqlNow(expiresAt));
    }
    db.prepare("UPDATE users SET plan=?, trial_ends_at=NULL WHERE id=?").run(id, userId);
    if (orderId) db.prepare("UPDATE orders SET status='paid', paid_at=datetime('now'), plan_title=? WHERE id=?").run(plan.title, orderId);
  })();
  notifyStatusChange(user, `Подписка ${plan.title} активирована до ${String(sqlNow(expiresAt)).slice(0, 10)}`);
  return { plan, subscription: activeSubscription(userId), startedAt: sqlNow(startedAt), expiresAt: sqlNow(expiresAt), renewed: Boolean(renewSame) };
}

/** Ручное продление/назначение из админки (без оплаты). */
export function adminAssign({ userId, planId, days = 30, kind = 'paid' }) {
  const id = normalizePlanId(planId);
  if (kind === 'trial') {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!user) throw new SubscriptionError('Пользователь не найден', 404);
    if (user.trial_used) throw new SubscriptionError('Пробный период уже использован', 409, 'trial_used');
    return startTrial(user);
  }
  return activateSubscription({ userId, planId: id, days, provider: 'admin', source: 'admin' });
}

export function extendSubscription({ userId, days = 30 }) {
  const sub = activeSubscription(userId);
  const termDays = Math.max(1, Math.min(3660, Math.round(Number(days) || 30)));
  if (!sub) {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!user) throw new SubscriptionError('Пользователь не найден', 404);
    const planId = PAID_PLANS.has(normalizePlanId(user.plan)) ? normalizePlanId(user.plan) : 'pro';
    return activateSubscription({ userId, planId, days: termDays, provider: 'admin', source: 'admin' });
  }
  const base = asDate(sub.expires_at) || new Date();
  const expires = addDays(base > new Date() ? base : new Date(), termDays);
  db.transaction(() => {
    db.prepare('UPDATE subscriptions SET expires_at=? WHERE id=?').run(sqlNow(expires), sub.id);
    db.prepare('UPDATE usage_periods SET period_end=? WHERE user_id=? AND period_start=?')
      .run(sqlNow(expires), userId, String(sub.started_at));
  })();
  return { subscription: activeSubscription(userId), expiresAt: sqlNow(expires) };
}

export function cancelSubscription(userId, { immediate = false } = {}) {
  const sub = activeSubscription(userId);
  if (!sub) throw new SubscriptionError('Активной подписки нет', 404);
  db.transaction(() => {
    if (immediate) {
      db.prepare("UPDATE subscriptions SET status='canceled', canceled_at=datetime('now'), auto_renew=0 WHERE id=?").run(sub.id);
      db.prepare("UPDATE users SET plan='free' WHERE id=?").run(userId);
    } else {
      db.prepare('UPDATE subscriptions SET auto_renew=0 WHERE id=?').run(sub.id);
    }
  })();
  return { subscription: activeSubscription(userId) };
}

export function setAutoRenew(userId, enabled) {
  const sub = activeSubscription(userId);
  if (!sub) throw new SubscriptionError('Активной подписки нет', 404);
  db.prepare('UPDATE subscriptions SET auto_renew=? WHERE id=?').run(enabled ? 1 : 0, sub.id);
  return { autoRenew: Boolean(enabled) };
}

/** Перевод истёкших подписок/триалов на FREE. Возвращает число изменений. */
export function expireSubscriptionsAndTrials() {
  const now = new Date();
  let changed = 0;
  const expiredSubs = db.prepare(
    "SELECT * FROM subscriptions WHERE status='active' AND expires_at <= datetime('now')"
  ).all();
  for (const sub of expiredSubs) {
    db.prepare("UPDATE subscriptions SET status='expired' WHERE id=?").run(sub.id);
    changed += 1;
  }
  // Триалы, которые закончились и не были оплачены
  const expiredTrials = db.prepare(
    "SELECT * FROM users WHERE plan='pro' AND trial_used=1 AND trial_ends_at IS NOT NULL AND trial_ends_at <= datetime('now') AND id NOT IN (SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > datetime('now'))"
  ).all();
  for (const user of expiredTrials) {
    db.prepare("UPDATE users SET plan='free' WHERE id=? AND plan='pro'").run(user.id);
    notifyStatusChange(user, 'Пробный период PRO закончился → FREE');
    notifyClient(user, 'trial_ended', { until: String(user.trial_ends_at || '').slice(0, 10) }).catch(() => {});
    changed += 1;
  }
  // Платные тарифы без активной подписки → FREE
  const paidWithoutSub = db.prepare(
    `SELECT * FROM users WHERE plan IN ('start','pro','business')
       AND id NOT IN (SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > datetime('now'))
       AND NOT (plan='pro' AND trial_used=1 AND trial_ends_at > datetime('now'))`
  ).all();
  for (const user of paidWithoutSub) {
    db.prepare("UPDATE users SET plan='free' WHERE id=?").run(user.id);
    notifyStatusChange(user, 'Подписка истекла → FREE');
    changed += 1;
  }
  return changed;
}

/** Напоминание за 2 дня до конца триала (in-app через /api/me + письмо/Telegram best-effort). */
export function remindTrialEnding() {
  const days = Math.max(1, Number(getSetting('trial_notice_days', '2')) || 2);
  const rows = db.prepare(
    `SELECT id, email, name, trial_ends_at FROM users
     WHERE plan='pro' AND trial_used=1 AND trial_ends_at IS NOT NULL
       AND trial_ends_at > datetime('now') AND trial_ends_at <= datetime('now', ?)
       AND (trial_notice_at IS NULL OR trial_notice_at < datetime('now','-3 days'))`
  ).all(`+${days} days`);
  for (const user of rows) {
    try {
      db.prepare("UPDATE users SET trial_notice_at=datetime('now') WHERE id=?").run(user.id);
      notifyStatusChange(user, `Пробный период PRO заканчивается ${String(user.trial_ends_at).slice(0, 10)}`);
      notifyClient(user, 'trial_expiring', { until: String(user.trial_ends_at).slice(0, 10) }).catch(() => {});
    } catch { /* уведомление не должно ломать свипер */ }
  }
  return rows.length;
}

export function trialDaysLeft(user) {
  return trialInfo(user).daysLeft;
}

let sweeper = null;
export function startSubscriptionSweeper() {
  expireSubscriptionsAndTrials();
  setTimeout(() => { try { remindTrialEnding(); } catch { /* ignore */ } }, 8 * 60_000).unref();
  if (sweeper) return;
  sweeper = setInterval(() => {
    try { expireSubscriptionsAndTrials(); } catch { /* ignore */ }
  }, 60_000);
  sweeper.unref?.();
}
