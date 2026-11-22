// Строки преимуществ тарифа — из полей таблицы plans (админка).
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
  const ops = Number(plan.opsPerPeriod ?? plan.ops_per_period ?? 0);
  const checks = Number(plan.checksPerPeriod ?? plan.checks_per_period ?? 0);
  const exportsLimit = Number(plan.exportsPerPeriod ?? plan.exports_per_period ?? 0);
  const apiLimit = Number(plan.apiCallsPerPeriod ?? plan.api_calls_per_period ?? 0);
  const rows = [
    { text: `${ops.toLocaleString('ru')} операций в месяц`, on: true },
    { text: Number(plan.dailyOps ?? plan.daily_ops) > 0 ? `До ${plan.dailyOps ?? plan.daily_ops} операций в сутки` : 'Без суточного ограничения', on: true },
    { text: checks > 0 ? `${checks.toLocaleString('ru')} расширенных проверок` : 'Без расширенных проверок', on: checks > 0 },
    { text: exportsLimit > 0 ? `${exportsLimit.toLocaleString('ru')} экспортов` : 'Без экспорта', on: exportsLimit > 0 },
    { text: apiLimit > 0 ? `${apiLimit.toLocaleString('ru')} API-запросов` : 'Без API-лимита', on: apiLimit > 0 },
    { text: `Пакет до ${Number(plan.batchMax ?? plan.batch_max ?? 0).toLocaleString('ru')} строк`, on: true },
    { text: `Выгрузка: ${formatList(plan)}`, on: true },
    { text: 'Редактор этикеток и печать с термопринтера', on: Boolean(plan.features?.labelEditor ?? plan.labelEditor) },
    { text: 'Сохранение шаблонов', on: Boolean(plan.features?.templates ?? plan.templates) },
    { text: 'API для 1С и складов', on: Boolean(plan.features?.apiAccess ?? plan.apiAccess) },
    { text: 'AI-помощник', on: Boolean(plan.features?.aiAssistant ?? plan.aiAssistant ?? true) },
    { text: `Сотрудников: до ${Number(plan.features?.employees ?? plan.employees ?? 1)}`, on: true },
    { text: `История ${Number(plan.historyDays ?? plan.history_days ?? 0)} дней`, on: true },
    { text: `Архив ${formatArchiveSize(plan.archiveMb ?? plan.archive_mb)}`, on: true }
  ];
  return onlyEnabled ? rows.filter((r) => r.on) : rows;
}
