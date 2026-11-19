export const PLANS = {
  free: {
    id: 'free',
    title: 'FREE',
    priceMonthly: 0,
    codesPerDay: 50,
    batchMax: 20,
    formats: ['png', 'svg'],
    labelEditor: false,
    printBridge: false,
    apiAccess: false,
    historyDays: 7,
    archiveMb: 50
  },
  premium: {
    id: 'premium',
    title: 'PREMIUM',
    priceMonthly: 1990,
    codesPerDay: 10000,
    batchMax: 5000,
    formats: ['png', 'svg', 'pdf', 'zip'],
    labelEditor: true,
    printBridge: true,
    apiAccess: true,
    historyDays: 365,
    archiveMb: 2048
  },
  // Тестовый тариф: 1 ₽ за 30 дней полного PREMIUM-доступа.
  // Нужен для боевой проверки платежа через YooKassa без траты 1990 ₽.
  // Активирует план 'premium'; покупка доступна только администратору.
  test: {
    id: 'test',
    title: 'TEST',
    priceMonthly: 1,
    codesPerDay: 10000,
    batchMax: 5000,
    formats: ['png', 'svg', 'pdf', 'zip'],
    labelEditor: true,
    printBridge: true,
    apiAccess: true,
    historyDays: 365,
    archiveMb: 2048
  }
};

// Тарифы, которые можно купить через checkout
export const PURCHASABLE = ['premium', 'archive'];

// Лимиты можно менять из админки: переопределения хранятся в app_settings.plan_limits
const LIMIT_RANGES = { codesPerDay: [1, 1000000], batchMax: [1, 100000], historyDays: [1, 3650], archiveMb: [10, 102400] };
const BOOLEAN_LIMITS = ['apiAccess', 'labelEditor', 'printBridge'];
const FORMATS = ['png', 'svg', 'pdf', 'zip'];

function limitOverrides() {
  try {
    const raw = getSetting('plan_limits', '');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function sanitizeLimits(input) {
  const out = {};
  if (!input || typeof input !== 'object') return { error: 'Нет данных' };
  for (const [key, [min, max]] of Object.entries(LIMIT_RANGES)) {
    if (input[key] === undefined) continue;
    const n = Math.round(Number(input[key]));
    if (!Number.isFinite(n) || n < min || n > max) return { error: `${key}: ${min}–${max}` };
    out[key] = n;
  }
  for (const key of BOOLEAN_LIMITS) {
    if (input[key] !== undefined) out[key] = Boolean(input[key]);
  }
  if (input.formats !== undefined) {
    if (!Array.isArray(input.formats)) return { error: 'formats: нужен массив' };
    const formats = [...new Set(input.formats.map(String).filter((f) => FORMATS.includes(f)))];
    if (!formats.length) return { error: 'Нужен хотя бы один формат' };
    out.formats = formats;
  }
  return { limits: out };
}

export function savePlanLimits(input) {
  const clean = {};
  for (const id of ['free', 'premium']) {
    if (!input?.[id]) continue;
    const r = sanitizeLimits(input[id]);
    if (r.error) return { error: `${id}: ${r.error}` };
    clean[id] = r.limits;
  }
  if (!Object.keys(clean).length) return { error: 'Нет данных' };
  setSetting('plan_limits', JSON.stringify(clean));
  return { ok: true };
}

export function planDef(id) {
  const base = PLANS[id] || PLANS.free;
  const extra = limitOverrides()[id] || {};
  return { ...base, ...extra };
}

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
        archiveMb: Math.max(Number(base.archiveMb) || 0, Number(addon.archive_mb) || 10240)
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

import { db } from './db.js';
import { getSetting, setSetting } from './settings.js';

// Округление до копеек
const round2 = (n) => Math.round(n * 100) / 100;

// Итоговая цена с учётом скидки (%)
export function offerFinalPrice(o) {
  const d = Number.isFinite(o.discount) ? Math.min(90, Math.max(0, o.discount)) : 0;
  return round2(o.price * (1 - d / 100));
}

// Редактируемые периоды PREMIUM: [{days, price, discount}]. По умолчанию 30 дней / 1990 ₽.
export function getPremiumOffers() {
  let base = [{ days: 30, price: PLANS.premium.priceMonthly, discount: 0 }];
  try {
    const raw = getSetting('premium_offers', '');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        base = arr.filter(o => Number.isFinite(o.days) && o.days > 0 && Number.isFinite(o.price) && o.price >= 0)
          .map(o => ({
            days: Math.round(o.days),
            price: round2(o.price),
            discount: Number.isFinite(o.discount) ? Math.min(90, Math.max(0, Math.round(o.discount))) : 0
          }))
          .sort((a, b) => a.days - b.days);
      }
    }
  } catch { /* битый JSON — fallback */ }
  // добавляем вычисленные поля для витрины
  return base.map(o => ({ ...o, finalPrice: offerFinalPrice(o), perMonth: round2(offerFinalPrice(o) / o.days * 30) }));
}

export function getTestPrice() {
  const raw = getSetting('test_price', '');
  if (raw === '') return PLANS.test.priceMonthly;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : PLANS.test.priceMonthly;
}

// Публичное представление тарифов для витрины/checkout
export function publicPlans() {
  const offers = getPremiumOffers();
  return {
    free: planDef('free'),
    premium: { ...planDef('premium'), offers, priceMonthly: offers[0]?.finalPrice ?? PLANS.premium.priceMonthly }
  };
}
