// Строки преимуществ тарифа — из тех же лимитов, что меняются в админке.
export const formatList = (plan) => (plan?.formats || []).map((f) => String(f).toUpperCase()).join(', ');

export function planFeatureRows(plan, { onlyEnabled = false } = {}) {
  if (!plan) return [];
  const rows = [
    { text: `${Number(plan.codesPerDay || 0).toLocaleString('ru')} кодов в день`, on: true },
    { text: `Пакет до ${Number(plan.batchMax || 0).toLocaleString('ru')} строк`, on: true },
    { text: `Форматы ${formatList(plan)}`, on: true },
    { text: 'Редактор этикеток', on: Boolean(plan.labelEditor) },
    { text: 'Печать на термопринтер (Print Bridge)', on: Boolean(plan.printBridge) },
    { text: 'API для 1С и складов', on: Boolean(plan.apiAccess) },
    { text: `История ${Number(plan.historyDays || 0)} дней`, on: true }
  ];
  return onlyEnabled ? rows.filter((r) => r.on) : rows;
}
