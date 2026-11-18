import { validateRow } from './gs1.js';
import { getSetting } from './settings.js';

export function czStatus() {
  const enabled = getSetting('cz_enabled', '0') === '1';
  const token = getSetting('cz_token', '');
  const apiUrl = getSetting('cz_api_url', 'https://api.mdlp.crpt.ru');
  return { enabled, configured: Boolean(token), apiUrl };
}

// Локальная валидация GS1 всегда; онлайн-проверка ГИС МТ активируется после настройки УКЭП/токенов
export async function verifyCodes(codes, mode = 'cz') {
  const results = codes.map(c => ({ code: String(c).slice(0, 300), ...validateRow(c, mode) }));
  const st = czStatus();
  if (!st.enabled || !st.configured) {
    return { configured: false, online: false, message: 'Онлайн-проверка в ГИС МТ не подключена — выполнена локальная валидация GS1. Ключи API: честныйзнак.рф, раздел для участников оборота.', results };
  }
  return { configured: true, online: false, message: 'Настройки сохранены. Онлайн-проверка ГИС МТ требует подключения УКЭП — будет активирована отдельно. Пока выполнена локальная валидация GS1.', results };
}
