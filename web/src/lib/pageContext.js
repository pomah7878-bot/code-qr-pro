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
    chips: ['Как сгенерировать GS1 DataMatrix?', 'Ошибка при генерации', 'Какой формат выбрать?']
  },
  labels: {
    label: 'Этикетки',
    chips: ['Не тот размер PDF', 'Как напечатать этикетки?', 'Код не читается сканером']
  },
  sets: {
    label: 'Наборы',
    chips: ['Что такое КИН?', 'Набор не создаётся', 'Как скачать набор?']
  },
  reprint: {
    label: 'Повторная печать',
    chips: ['Как перепечатать этикетки?', 'Не находит задание', 'PDF не открывается']
  },
  billing: {
    label: 'Подписка',
    chips: ['Какие лимиты у тарифов?', 'Как продлить подписку?', 'Не прошла оплата']
  },
  apikeys: {
    label: 'API',
    chips: ['Как создать ключ?', 'Сколько запросов в API?', 'Как отозвать ключ?']
  },
  cz: {
    label: 'Честный ЗНАК',
    chips: ['Как проверить код?', 'Что значит статус кода?', 'Код не проходит проверку']
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
    chips: ['С чего начать?', 'Код не читается', 'Как распечатать этикетки?']
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
  ['/app', 'overview']
];

export function pageContext(path = '') {
  const found = ROUTE_TO_KEY.find(([prefix]) => (prefix === '/app' ? path === '/app' || path === '/app/' : path.startsWith(prefix)));
  const key = found ? found[1] : 'overview';
  return { key, ...PAGE_CONTEXTS[key] };
}
