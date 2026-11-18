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
  }
};

export function planOf(user) {
  return PLANS[user?.plan] || PLANS.free;
}
