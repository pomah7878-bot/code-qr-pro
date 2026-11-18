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

// Тарифы, которые можно купить через checkout (test — только админ)
export const PURCHASABLE = ['premium', 'test'];

export function planOf(user) {
  return PLANS[user?.plan] || PLANS.free;
}
