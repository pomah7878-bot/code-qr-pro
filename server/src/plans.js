import { db } from './db.js';
import { getSetting, setSetting } from './settings.js';

/**
 * Тарифы теперь хранятся в таблице plans (миграция v29) и редактируются из админки.
 * Модуль сохраняет обратную совместимость со старым кодом (planOf, planDef,
 * publicPlans, getPremiumOffers), но источник истины — БД.
 */

const LEGACY_MAP = { premium: 'pro', test: 'pro', archive: 'archive' };
const BUILTIN_DEFAULTS = {
  free: {
    id: 'free', title: 'FREE',
    price_monthly: 0, price_yearly: 0,
    ops_per_period: 600, daily_ops: 20, checks_per_period: 0,
    batch_max: 20,
    formats: ['png', 'svg', 'pdf'], history_days: 7, archive_mb: 50,
    features: { labelEditor: false, printBridge: false, apiAccess: false, aiAssistant: true, templates: false, employees: 1, extendedChecks: false },
    sort_order: 1, recommended: 0, active: 1
  },
  start: {
    id: 'start', title: 'START',
    price_monthly: 149, price_yearly: 1490,
    ops_per_period: 500, daily_ops: 0, checks_per_period: 0,
    batch_max: 5000,
    formats: ['png', 'svg', 'pdf'], history_days: 7, archive_mb: 500,
    features: { labelEditor: false, printBridge: false, apiAccess: false, aiAssistant: true, templates: false, employees: 1, extendedChecks: false },
    sort_order: 2, recommended: 0, active: 1
  },
  pro: {
    id: 'pro', title: 'PRO',
    price_monthly: 349, price_yearly: 3490,
    ops_per_period: 5000, daily_ops: 0, checks_per_period: 500,
    batch_max: 5000,
    formats: ['png', 'svg', 'pdf', 'zip'], history_days: 30, archive_mb: 2048,
    features: { labelEditor: true, printBridge: true, apiAccess: true, aiAssistant: true, templates: true, employees: 1, extendedChecks: true },
    sort_order: 3, recommended: 1, active: 1
  },
  business: {
    id: 'business', title: 'BUSINESS',
    price_monthly: 799, price_yearly: 7990,
    ops_per_period: 30000, daily_ops: 0, checks_per_period: 3000,
    batch_max: 5000,
    formats: ['png', 'svg', 'pdf', 'zip'], history_days: 1095, archive_mb: 10240,
    features: { labelEditor: true, printBridge: true, apiAccess: true, aiAssistant: true, templates: true, employees: 5, extendedChecks: true },
    sort_order: 4, recommended: 0, active: 1
  }
};

// Совместимость: старый код читает PLANS.premium и т.п.
export const PLANS = {
  free: legacyView(rowFromDefaults('free')),
  start: legacyView(rowFromDefaults('start')),
  pro: legacyView(rowFromDefaults('pro')),
  business: legacyView(rowFromDefaults('business')),
  premium: legacyView(rowFromDefaults('pro')),
  test: legacyView(rowFromDefaults('pro'))
};

export const PURCHASABLE = ['start', 'pro', 'business', 'archive'];

function rowFromDefaults(id) {
  const d = BUILTIN_DEFAULTS[id];
  return { ...d, formats: [...d.formats], features: { ...d.features } };
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch { return fallback; }
}

function dbRowToPlan(row) {
  if (!row) return null;
  const features = parseJson(row.features, {});
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    priceMonthly: Number(row.price_monthly) || 0,
    priceYearly: Number(row.price_yearly) || 0,
    price_monthly: Number(row.price_monthly) || 0,
    price_yearly: Number(row.price_yearly) || 0,
    ops_per_period: Number(row.ops_per_period) || 0,
    daily_ops: Number(row.daily_ops) || 0,
    checks_per_period: Number(row.checks_per_period) || 0,
    opsPerPeriod: Number(row.ops_per_period) || 0,
    dailyOps: Number(row.daily_ops) || 0,
    checksPerPeriod: Number(row.checks_per_period) || 0,
    batch_max: Number(row.batch_max) || 0,
    batchMax: Number(row.batch_max) || 0,
    formats: parseJson(row.formats, ['png', 'svg']),
    historyDays: Number(row.history_days) || 0,
    history_days: Number(row.history_days) || 0,
    archiveMb: Number(row.archive_mb) || 0,
    archive_mb: Number(row.archive_mb) || 0,
    features,
    labelEditor: Boolean(features.labelEditor),
    printBridge: Boolean(features.printBridge),
    apiAccess: Boolean(features.apiAccess),
    aiAssistant: Boolean(features.aiAssistant),
    templates: Boolean(features.templates),
    employees: Number(features.employees) || 1,
    extendedChecks: Boolean(features.extendedChecks),
    sortOrder: Number(row.sort_order) || 0,
    recommended: Boolean(row.recommended),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Старое представление тарифа (коды/день и пр.) для существующего UI и API. */
function legacyView(plan) {
  if (!plan) return null;
  const daily = plan.dailyOps || 0;
  return {
    ...plan,
    codesPerDay: daily || (plan.opsPerPeriod ? Math.max(1, Math.round(plan.opsPerPeriod / 30)) : 0),
    codesPerDayHard: daily,
    offers: plan.id === 'pro' ? getPremiumOffers() : undefined,
    priceMonthly: plan.priceMonthly
  };
}

export function normalizePlanId(id) {
  const value = String(id || '').trim().toLowerCase();
  return LEGACY_MAP[value] || value || 'free';
}

export function listPlans({ activeOnly = false, includeArchive = false } = {}) {
  let rows;
  try {
    rows = db.prepare('SELECT * FROM plans ORDER BY sort_order, id').all();
  } catch {
    rows = [];
  }
  let plans = rows.map(dbRowToPlan).filter(Boolean);
  if (!plans.length) plans = Object.keys(BUILTIN_DEFAULTS).map((id) => dbRowToPlanFromDefaults(id));
  if (activeOnly) plans = plans.filter((p) => p.active);
  if (!includeArchive) plans = plans.filter((p) => p.id !== 'archive');
  return plans;
}

function dbRowToPlanFromDefaults(id) {
  const d = BUILTIN_DEFAULTS[id];
  return dbRowToPlan({
    id: d.id, title: d.title, description: '', price_monthly: d.price_monthly,
    price_yearly: d.price_yearly, ops_per_period: d.ops_per_period, daily_ops: d.daily_ops,
    checks_per_period: d.checks_per_period, batch_max: d.batch_max, formats: JSON.stringify(d.formats),
    history_days: d.history_days, archive_mb: d.archive_mb, features: JSON.stringify(d.features),
    sort_order: d.sort_order, recommended: d.recommended, active: 1
  });
}

export function getPlan(id) {
  const planId = normalizePlanId(id);
  try {
    const row = db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
    if (row) return dbRowToPlan(row);
  } catch { /* миграция ещё не применилась */ }
  return BUILTIN_DEFAULTS[planId] ? dbRowToPlanFromDefaults(planId) : null;
}

/** Старый API: planDef('free'|'premium'). */
export function planDef(id) {
  const plan = getPlan(id);
  return legacyView(plan) || legacyView(dbRowToPlanFromDefaults('free'));
}

/** Тариф пользователя (для обратной совместимости — без периода/подписки). */
export function planOf(user) {
  const base = planDef(user?.plan);
  if (!user?.id) return base;
  try {
    const addon = db.prepare(
      "SELECT archive_until, archive_mb FROM users WHERE id=? AND archive_until IS NOT NULL AND archive_until > datetime('now')"
    ).get(user.id);
    if (addon) {
      return {
        ...base,
        historyDays: Math.max(Number(base.historyDays) || 0, 1095),
        archiveMb: Math.max(Number(base.archiveMb) || 0, Number(addon.archive_mb) || 10240),
        formats: [...new Set([...(base.formats || []), 'zip'])],
        archiveAddon: true
      };
    }
  } catch { /* ignore */ }
  return base;
}

export function archiveAddon() {
  const price = Number(getSetting('archive_addon_price', '990'));
  const days = Number(getSetting('archive_addon_days', '1095'));
  const mb = Number(getSetting('archive_addon_mb', '10240'));
  return {
    price: Number.isFinite(price) && price > 0 ? price : 990,
    days: Number.isFinite(days) && days > 0 ? Math.round(days) : 1095,
    mb: Number.isFinite(mb) && mb > 0 ? Math.round(mb) : 10240
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

export function offerFinalPrice(o) {
  const d = Number.isFinite(o.discount) ? Math.min(90, Math.max(0, o.discount)) : 0;
  return round2(o.price * (1 - d / 100));
}

/** Старые «офферы PREMIUM» = цена PRO за месяц/год. */
export function getPremiumOffers() {
  const pro = getPlan('pro') || dbRowToPlanFromDefaults('pro');
  let offers = [
    { days: 30, price: pro.priceMonthly || 349, discount: 0, period: 'month' },
    { days: 365, price: pro.priceYearly || Math.round((pro.priceMonthly || 349) * 10), discount: 0, period: 'year' }
  ];
  try {
    const raw = getSetting('premium_offers', '');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        offers = arr.filter((o) => Number.isFinite(o.days) && o.days > 0 && Number.isFinite(o.price) && o.price >= 0)
          .map((o) => ({
            days: Math.round(o.days),
            price: round2(o.price),
            discount: Number.isFinite(o.discount) ? Math.min(90, Math.max(0, Math.round(o.discount))) : 0,
            period: o.days >= 300 ? 'year' : 'month'
          }))
          .sort((a, b) => a.days - b.days);
      }
    }
  } catch { /* битый JSON — fallback */ }
  return offers.map((o) => ({
    ...o,
    finalPrice: offerFinalPrice(o),
    perMonth: round2(offerFinalPrice(o) / o.days * 30)
  }));
}

export function getTestPrice() {
  const raw = getSetting('test_price', '');
  if (raw === '') return 1;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Публичная витрина: все активные тарифы + совместимый ключ premium. */
export function publicPlans() {
  const map = {};
  for (const plan of listPlans({ activeOnly: true })) {
    map[plan.id] = { ...legacyView(plan), offers: plan.id === 'pro' ? getPremiumOffers() : undefined };
  }
  if (!map.premium && map.pro) map.premium = { ...map.pro, legacy: true };
  return map;
}

/** Админка: валидация и сохранение тарифа (upsert). */
export function validatePlanInput(input = {}) {
  const id = String(input.id || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(id)) return { error: 'ID тарифа: латиница, 2–31 символ' };
  const title = String(input.title || '').trim().slice(0, 60);
  if (!title) return { error: 'Укажите название тарифа' };
  const num = (value, min, max, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) return NaN;
    return n;
  };
  const priceMonthly = num(input.priceMonthly ?? input.price_monthly, 0, 1_000_000, 0);
  const priceYearly = num(input.priceYearly ?? input.price_yearly, 0, 12_000_000, 0);
  const ops = num(input.opsPerPeriod ?? input.ops_per_period, 0, 10_000_000, 0);
  const daily = num(input.dailyOps ?? input.daily_ops, 0, 1_000_000, 0);
  const checks = num(input.checksPerPeriod ?? input.checks_per_period, 0, 10_000_000, 0);
  const batchMax = num(input.batchMax ?? input.batch_max, 1, 100_000, 100);
  const historyDays = num(input.historyDays ?? input.history_days, 1, 3650, 7);
  const archiveMb = num(input.archiveMb ?? input.archive_mb, 10, 102400, 50);
  if ([priceMonthly, priceYearly, ops, daily, checks, batchMax, historyDays, archiveMb].some((n) => Number.isNaN(n))) {
    return { error: 'Проверьте числа: лимиты и цены должны быть в допустимых диапазонах' };
  }
  const formats = Array.isArray(input.formats)
    ? [...new Set(input.formats.map(String).filter((f) => ['png', 'svg', 'pdf', 'zip'].includes(f)))]
    : ['png', 'svg'];
  if (!formats.length) formats.push('png');
  const rawFeatures = input.features && typeof input.features === 'object' ? input.features : {};
  const features = {
    labelEditor: Boolean(rawFeatures.labelEditor),
    printBridge: Boolean(rawFeatures.printBridge),
    apiAccess: Boolean(rawFeatures.apiAccess),
    aiAssistant: rawFeatures.aiAssistant !== false,
    templates: Boolean(rawFeatures.templates),
    employees: Math.max(1, Math.min(1000, Math.round(Number(rawFeatures.employees) || 1))),
    extendedChecks: Boolean(rawFeatures.extendedChecks) || checks > 0
  };
  return {
    plan: {
      id,
      title,
      description: String(input.description || '').slice(0, 300),
      price_monthly: round2(priceMonthly),
      price_yearly: round2(priceYearly),
      ops_per_period: Math.round(ops),
      daily_ops: Math.round(daily),
      checks_per_period: Math.round(checks),
      batch_max: Math.round(batchMax),
      formats: JSON.stringify(formats),
      history_days: Math.round(historyDays),
      archive_mb: Math.round(archiveMb),
      features: JSON.stringify(features),
      sort_order: Math.max(0, Math.min(999, Math.round(Number(input.sortOrder ?? input.sort_order) || 0))),
      recommended: input.recommended ? 1 : 0,
      active: input.active === false ? 0 : 1
    }
  };
}

export function savePlan(input) {
  const checked = validatePlanInput(input);
  if (checked.error) return checked;
  const p = checked.plan;
  db.transaction(() => {
    db.prepare(`INSERT INTO plans
      (id,title,description,price_monthly,price_yearly,ops_per_period,daily_ops,checks_per_period,
       batch_max,formats,history_days,archive_mb,features,sort_order,recommended,active,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, description=excluded.description, price_monthly=excluded.price_monthly,
        price_yearly=excluded.price_yearly, ops_per_period=excluded.ops_per_period,
        daily_ops=excluded.daily_ops, checks_per_period=excluded.checks_per_period,
        batch_max=excluded.batch_max, formats=excluded.formats, history_days=excluded.history_days,
        archive_mb=excluded.archive_mb, features=excluded.features, sort_order=excluded.sort_order,
        recommended=excluded.recommended, active=excluded.active, updated_at=datetime('now')`)
      .run(p.id, p.title, p.description, p.price_monthly, p.price_yearly, p.ops_per_period,
        p.daily_ops, p.checks_per_period, p.batch_max, p.formats, p.history_days, p.archive_mb,
        p.features, p.sort_order, p.recommended, p.active);
    // рекомендованным может быть только один тариф
    if (p.recommended) db.prepare('UPDATE plans SET recommended=0 WHERE id<>?').run(p.id);
  })();
  return { plan: getPlan(p.id) };
}

export function deletePlan(id) {
  const planId = normalizePlanId(id);
  if (['free', 'start', 'pro', 'business'].includes(planId)) {
    const plan = getPlan(planId);
    if (!plan) return { error: 'Тариф не найден' };
    db.prepare('UPDATE plans SET active=0, recommended=0, updated_at=datetime(\'now\') WHERE id=?').run(planId);
    return { ok: true, plan: getPlan(planId) };
  }
  db.prepare('DELETE FROM plans WHERE id=?').run(planId);
  return { ok: true };
}

/** Совместимость со старой админкой (PlanLimitsCard): правит лимиты через таблицу plans. */
export function sanitizeLimits(input) {
  if (!input || typeof input !== 'object') return { error: 'Нет данных' };
  const out = {};
  const plan = getPlan(input.id || '');
  if (!plan) return { error: 'Неизвестный тариф' };
  const map = {
    codesPerDay: 'daily_ops',
    batchMax: 'batch_max',
    historyDays: 'history_days',
    archiveMb: 'archive_mb'
  };
  for (const [from, to] of Object.entries(map)) {
    if (input[from] === undefined) continue;
    const n = Math.round(Number(input[from]));
    if (!Number.isFinite(n) || n < 0) return { error: `${from}: некорректное значение` };
    out[to] = n;
  }
  for (const key of ['apiAccess', 'labelEditor', 'printBridge']) {
    if (input[key] !== undefined) out[key] = Boolean(input[key]);
  }
  if (Array.isArray(input.formats)) {
    out.formats = [...new Set(input.formats.map(String).filter((f) => ['png', 'svg', 'pdf', 'zip'].includes(f)))];
  }
  return { limits: out };
}

export function savePlanLimits(input) {
  const pro = getPlan('pro');
  const free = getPlan('free');
  if (!pro || !free) return { error: 'Тарифы не найдены' };
  const apply = (base, patch) => {
    const features = { ...base.features, ...(patch.apiAccess !== undefined ? { apiAccess: patch.apiAccess } : {}), ...(patch.labelEditor !== undefined ? { labelEditor: patch.labelEditor } : {}), ...(patch.printBridge !== undefined ? { printBridge: patch.printBridge } : {}) };
    return {
      ...base,
      daily_ops: patch.daily_ops ?? base.daily_ops,
      batch_max: patch.batch_max ?? base.batch_max,
      history_days: patch.history_days ?? base.history_days,
      archive_mb: patch.archive_mb ?? base.archive_mb,
      formats: patch.formats ?? base.formats,
      features
    };
  };
  for (const id of ['free', 'premium', 'start', 'pro', 'business']) {
    if (!input?.[id]) continue;
    const r = sanitizeLimits(input[id]);
    if (r.error) return { error: `${id}: ${r.error}` };
    const targetId = normalizePlanId(id);
    const base = getPlan(targetId);
    if (!base) continue;
    const updated = apply(base, r.limits);
    const saved = savePlan({ ...updated, id: targetId, title: base.title, priceMonthly: base.priceMonthly, priceYearly: base.priceYearly, recommended: base.recommended, active: base.active, opsPerPeriod: base.opsPerPeriod, checksPerPeriod: base.checksPerPeriod });
    if (saved.error) return saved;
  }
  return { ok: true };
}
