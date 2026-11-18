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
    historyDays: 7
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
    historyDays: 365
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
    historyDays: 365
  }
};

// Тарифы, которые можно купить через checkout
export const PURCHASABLE = ['premium'];

export function planOf(user) {
  return PLANS[user?.plan] || PLANS.free;
}

import { getSetting } from './settings.js';

// Редактируемые периоды PREMIUM: [{days, price}]. По умолчанию 30 дней / 1990 ₽.
export function getPremiumOffers() {
  try {
    const raw = getSetting('premium_offers', '');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.filter(o => Number.isFinite(o.days) && o.days > 0 && Number.isFinite(o.price) && o.price >= 0)
          .map(o => ({ days: Math.round(o.days), price: Math.round(o.price * 100) / 100 }))
          .sort((a, b) => a.days - b.days);
      }
    }
  } catch { /* битый JSON — fallback */ }
  return [{ days: 30, price: PLANS.premium.priceMonthly }];
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
    free: PLANS.free,
    premium: { ...PLANS.premium, offers, priceMonthly: offers[0]?.price ?? PLANS.premium.priceMonthly }
  };
}
