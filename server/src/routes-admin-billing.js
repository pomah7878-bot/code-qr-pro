import { db } from './db.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { listPlans, savePlan, deletePlan, getPlan, archiveAddon } from './plans.js';
import {
  entitlements, adminAssign, extendSubscription, startTrial, cancelSubscription,
  setAutoRenew, activeSubscription, trialInfo, SubscriptionError
} from './lib/subscription.js';
import { usageSummary, currentPeriod } from './lib/subscription.js';

const fail = (reply, e) => reply.code(e?.statusCode || 400).send({ error: String(e?.message || e), code: e?.code || null });

export async function registerAdminBillingRoutes(app) {
  // --- Тарифы ---
  app.get('/api/admin/billing/plans', { preHandler: requireAdmin }, async () => ({
    plans: listPlans({ includeArchive: true }),
    archive: archiveAddon()
  }));

  app.post('/api/admin/billing/plans', { preHandler: requireAdmin }, async (req, reply) => {
    const result = savePlan(req.body || {});
    if (result.error) return reply.code(400).send({ error: result.error });
    audit(req, 'billing.plan_save', 'plan', result.plan.id, { title: result.plan.title, priceMonthly: result.plan.priceMonthly });
    return result;
  });

  app.delete('/api/admin/billing/plans/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (normalizeProtected(req.params.id)) {
      return reply.code(400).send({ error: 'Базовые тарифы нельзя удалить — используйте отключение (active=false)' });
    }
    const result = deletePlan(req.params.id);
    if (result.error) return reply.code(400).send({ error: result.error });
    audit(req, 'billing.plan_delete', 'plan', req.params.id, {});
    return result;
  });

  // --- Подписки и пользователи ---
  app.get('/api/admin/billing/subscriptions', { preHandler: requireAdmin }, async (req) => {
    const q = String(req.query?.query || '').trim();
    const plan = String(req.query?.plan || '').trim();
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
    const where = [];
    const params = [];
    if (q) { where.push('(u.email LIKE ? OR u.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (plan) { where.push('u.plan=?'); params.push(plan); }
    const rows = db.prepare(
      `SELECT u.id, u.email, u.name, u.plan, u.status, u.created_at,
              u.trial_started_at, u.trial_ends_at, u.trial_used,
              s.id AS sub_id, s.status AS sub_status, s.started_at, s.expires_at, s.auto_renew, s.plan_title
         FROM users u
         LEFT JOIN subscriptions s ON s.id = (
           SELECT id FROM subscriptions WHERE user_id=u.id AND status='active' AND expires_at > datetime('now')
           ORDER BY expires_at DESC LIMIT 1
         )
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY u.id DESC LIMIT ?`
    ).all(...params, limit);
    const items = rows.map((row) => {
      const user = { id: row.id };
      const info = entitlements(user);
      return {
        ...row,
        planDef: getPlan(row.plan),
        trial: trialInfo(user),
        usage: info.usage
      };
    });
    return { users: items, total: items.length };
  });

  app.get('/api/admin/billing/user/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    const period = currentPeriod(user);
    return {
      user: {
        id: user.id, email: user.email, name: user.name, plan: user.plan,
        status: user.status, created_at: user.created_at,
        trial_started_at: user.trial_started_at, trial_ends_at: user.trial_ends_at, trial_used: user.trial_used
      },
      entitlements: entitlements(user),
      usage: usageSummary(user, period),
      subscriptions: db.prepare('SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 20').all(user.id),
      payments: db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 20').all(user.id),
      usagePeriods: db.prepare('SELECT * FROM usage_periods WHERE user_id=? ORDER BY id DESC LIMIT 12').all(user.id),
      events: db.prepare('SELECT * FROM usage_events WHERE user_id=? ORDER BY id DESC LIMIT 30').all(user.id)
    };
  });

  app.post('/api/admin/billing/user/:id/assign', { preHandler: requireAdmin }, async (req, reply) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    try {
      const planId = req.body?.planId || req.body?.plan;
      const days = Number(req.body?.days) || 30;
      const kind = req.body?.kind === 'trial' ? 'trial' : 'paid';
      const result = adminAssign({ userId: user.id, planId, days, kind });
      audit(req, kind === 'trial' ? 'billing.trial_grant' : 'billing.plan_assign', 'user', user.id, { planId, days, kind });
      return { ok: true, ...result };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/admin/billing/user/:id/extend', { preHandler: requireAdmin }, async (req, reply) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    try {
      const days = Math.max(1, Math.min(3660, Number(req.body?.days) || 30));
      const result = extendSubscription({ userId: user.id, days });
      audit(req, 'billing.extend', 'user', user.id, { days });
      return { ok: true, ...result };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/admin/billing/user/:id/trial', { preHandler: requireAdmin }, async (req, reply) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    try {
      const result = startTrial(user);
      audit(req, 'billing.trial_grant', 'user', user.id, { days: result.days });
      return { ok: true, ...result };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/admin/billing/user/:id/cancel', { preHandler: requireAdmin }, async (req, reply) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
    try {
      const result = cancelSubscription(user.id, { immediate: Boolean(req.body?.immediate) });
      audit(req, 'billing.cancel_admin', 'user', user.id, { immediate: Boolean(req.body?.immediate) });
      return { ok: true, ...result };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/admin/billing/user/:id/auto-renew', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const result = setAutoRenew(req.params.id, Boolean(req.body?.enabled));
      audit(req, 'billing.auto_renew_admin', 'user', Number(req.params.id), { enabled: Boolean(req.body?.enabled) });
      return { ok: true, ...result };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Ошибки интеграций и стоимость внешних запросов ---
  app.get('/api/admin/billing/errors', { preHandler: requireAdmin }, async (req) => {
    const limit = Math.min(300, Math.max(1, Number(req.query?.limit) || 100));
    const failed = db.prepare(
      'SELECT * FROM external_requests WHERE ok=0 ORDER BY id DESC LIMIT ?'
    ).all(limit);
    const integrationErrors = db.prepare(
      "SELECT id, level, source, event, message, created_at FROM app_logs WHERE level IN ('error','warn') AND source IN ('server','support','mail','billing') ORDER BY id DESC LIMIT ?"
    ).all(limit);
    const stats = db.prepare(
      `SELECT date(created_at) AS day, adapter, COUNT(*) AS total,
              SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS failed,
              SUM(cost_units) AS cost_units,
              ROUND(AVG(latency_ms)) AS avg_latency_ms
         FROM external_requests
         WHERE created_at > datetime('now','-30 days')
         GROUP BY day, adapter ORDER BY day DESC LIMIT 60`
    ).all();
    return { failed, integrationErrors, stats };
  });

  app.get('/api/admin/billing/stats', { preHandler: requireAdmin }, async () => {
    const byPlan = db.prepare('SELECT plan, COUNT(*) AS count FROM users GROUP BY plan ORDER BY count DESC').all();
    const paid = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS sum FROM orders WHERE status='paid' AND paid_at > datetime('now','-30 days')").get();
    const trials = db.prepare("SELECT COUNT(*) AS active FROM users WHERE trial_ends_at > datetime('now') AND plan='pro'").get();
    const usagePeriods = db.prepare(
      "SELECT plan, COUNT(*) AS periods, SUM(ops_used) AS ops, SUM(checks_used) AS checks FROM usage_periods WHERE period_start > datetime('now','-30 days') GROUP BY plan"
    ).all();
    return { byPlan, paid30d: paid, activeTrials: trials.active, usagePeriods };
  });

}

function normalizeProtected(id) {
  return ['free', 'start', 'pro', 'business'].includes(String(id || '').toLowerCase());
}
