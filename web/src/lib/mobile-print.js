import { isIOS, isMobile } from './print.js';

export const MOBILE_PDF_LIMIT = 1500;
export const MOBILE_PRINT_LIMIT = 250;

/** Ограничения и подсказки для печати с телефона: большие пакеты валят мобильный браузер. */
export function mobilePdfGuard(count) {
  const n = Number(count) || 0;
  if (!isMobile() || n <= MOBILE_PDF_LIMIT) return '';
  const limit = MOBILE_PDF_LIMIT.toLocaleString('ru');
  return `На телефоне — до ${limit} этикеток за раз. Уменьшите пакет или сформируйте PDF с компьютера.`;
}

export function mobilePrintGuard(count) {
  if (isIOS()) return ''; // на iOS печать идёт через PDF, там свой лимит
  const n = Number(count) || 0;
  if (!isMobile() || n <= MOBILE_PRINT_LIMIT) return '';
  return `Печать из браузера на телефоне — до ${MOBILE_PRINT_LIMIT} этикеток. Для большего тиража скачайте PDF.`;
}

/** Что показать после подготовки PDF — разные шаги для iOS и Android. */
export function mobilePdfNotice() {
  if (isIOS()) return 'PDF открылся. Нажмите «Поделиться» → «Сохранить в Файлы» или «Напечатать» (AirPrint).';
  if (isMobile()) return 'PDF скачан. Откройте «Загрузки» → PDF → «Печать» (Mopria / служба печати Android).';
  return '';
}
