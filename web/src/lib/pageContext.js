/**
 * Контекст раздела кабинета для AI-помощника:
 * помощник понимает, в каком меню сейчас клиент, и отвечает с учётом раздела.
 */
export const PAGE_CONTEXTS = {
  overview: {
    label: 'Обзор',
    chips: ['Что означают мои лимиты?', 'Как начать работу?', 'Где скачать коды?']
  },
  history: {
    label: 'История',
    chips: ['Не могу скачать файл', 'Сколько хранится история?', 'Как найти старое задание?']
  },
  generate: {
    label: 'Генерация',
    chips: ['Как сгенерировать GS1 DataMatrix?', 'Какие форматы можно скачать?', 'Ошибка при генерации']
  },
  labels: {
    label: 'Этикетки',
    chips: ['Как настроить шаблон этикетки?', 'Не тот размер PDF', 'Код не читается сканером']
  },
  sets: {
    label: 'Наборы',
    chips: ['Что такое КИН?', 'Набор не создаётся', 'Как скачать набор?']
  },
  reprint: {
    label: 'Повторная печать',
    chips: ['Как добавить EAN-13 для OZON и Wildberries?', 'Откуда берутся дата изготовления и статус кода?', 'Код не найден в ЧЗ — что делать?']
  },
  billing: {
    label: 'Подписка',
    chips: ['Какие лимиты у тарифов?', 'Что даёт архив на 3 года?', 'Не прошла оплата']
  },
  apikeys: {
    label: 'API',
    chips: ['Как создать и использовать ключ?', 'Какой заголовок авторизации?', 'Сколько запросов в API?']
  },
  cz: {
    label: 'Честный ЗНАК',
    chips: ['Что значит «криптозащита не проверена»?', 'Чем КИЗ 91/92 отличается от GS1 93?', 'Код не проходит проверку']
  },
  reviews: {
    label: 'Отзывы',
    chips: ['Как оставить отзыв?', 'Почему отзыв не виден?']
  },
  security: {
    label: 'Безопасность',
    chips: ['Как включить 2FA?', 'Не получается войти', 'Как завершить сессии?']
  },
  assistant: {
    label: 'AI-помощник',
    chips: ['Что ты умеешь?', 'Как передать вопрос человеку?', 'Что нового в PRO?']
  },
  help: {
    label: 'Помощь',
    chips: ['Как напечатать этикетку с телефона?', 'Как передать обращение в поддержку?', 'Где найти инструкцию?']
  }
};

const ROUTE_TO_KEY = [
  ['/app/history', 'history'],
  ['/app/generate', 'generate'],
  ['/app/labels', 'labels'],
  ['/app/sets', 'sets'],
  ['/app/reprint', 'reprint'],
  ['/app/billing', 'billing'],
  ['/app/apikeys', 'apikeys'],
  ['/app/cz', 'cz'],
  ['/app/reviews', 'reviews'],
  ['/app/security', 'security'],
  ['/app/assistant', 'assistant'],
  ['/app/help', 'help'],
  ['/app', 'overview']
];

export function pageContext(path = '') {
  const found = ROUTE_TO_KEY.find(([prefix]) => (prefix === '/app' ? path === '/app' || path === '/app/' : path.startsWith(prefix)));
  const key = found ? found[1] : 'overview';
  return { key, ...PAGE_CONTEXTS[key] };
}
