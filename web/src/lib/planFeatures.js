// Строки преимуществ тарифа — из тех же лимитов, что меняются в админке.
export const formatList = (plan) => (plan?.formats || []).map((f) => String(f).toUpperCase()).join(', ');

export function formatArchiveSize(mb) {
  const value = Number(mb) || 0;
  if (value >= 1024) {
    const gb = value / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1).replace('.', ',')} ГБ`;
  }
  return `${value} МБ`;
}

export function planFeatureRows(plan, { onlyEnabled = false } = {}) {
  if (!plan) return [];
  const rows = [
    { text: `${Number(plan.codesPerDay || 0).toLocaleString('ru')} кодов в день`, on: true },
    { text: `Пакет до ${Number(plan.batchMax || 0).toLocaleString('ru')} строк`, on: true },
    { text: `Форматы ${formatList(plan)}`, on: true },
    { text: 'Редактор этикеток', on: Boolean(plan.labelEditor) },
    { text: 'Наборы: КИН и этикетки вложений', on: Boolean(plan.labelEditor) },
    { text: 'Печать на термопринтер (Print Bridge)', on: Boolean(plan.printBridge) },
    { text: 'API для 1С и складов', on: Boolean(plan.apiAccess) },
    { text: `История ${Number(plan.historyDays || 0)} дней`, on: true },
    { text: `Архив ${formatArchiveSize(plan.archiveMb)}`, on: true }
  ];
  return onlyEnabled ? rows.filter((r) => r.on) : rows;
}
