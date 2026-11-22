const SITE = 'https://code-qr.stockcity.ru';
const HOME = {
  title: 'CODE QR PRO — маркировка «Честный ЗНАК», DataMatrix и печать этикеток',
  description: 'Генерация GS1 DataMatrix, проверка кодов, наборы с КИН, редактор этикеток, печать PDF и из браузера, Print Bridge и API для 1С. FREE, START, PRO и BUSINESS.'
};

const PUBLIC_PAGES = {
  '/check': {
    title: 'Проверить код «Честного ЗНАКа» онлайн — CODE QR PRO',
    description: 'Бесплатная онлайн-проверка кода маркировки: структура GS1 DataMatrix, статус в открытых источниках «Честного ЗНАКа», GTIN, серийный номер и криптоподпись.'
  },
  '/pricing': {
    title: 'Тарифы и цены — CODE QR PRO',
    description: 'Тарифы FREE, START, PRO и BUSINESS: операции, расширенные проверки, история, API и печать. Цены за месяц и год.'
  },
  '/articles': {
    title: 'Статьи и инструкции по маркировке — CODE QR PRO',
    description: 'База знаний CODE QR PRO: GS1 DataMatrix, «Честный ЗНАК», этикетки, повторная печать, API, тарифы и разбор ошибок.'
  },
  '/faq': {
    title: 'Частые вопросы — CODE QR PRO',
    description: 'Ответы на вопросы о маркировке, генерации кодов, печати, тарифах, оплате, аккаунте и API сервиса CODE QR PRO.'
  },
  '/offer': {
    title: 'Публичная оферта — CODE QR PRO',
    description: 'Условия оказания услуг CODE QR PRO: тарифы, оплата, возвраты, ответственность и реквизиты исполнителя.'
  },
  '/terms': {
    title: 'Пользовательское соглашение — CODE QR PRO',
    description: 'Правила использования сервиса CODE QR PRO: аккаунт, допустимое использование, оплата, API и ответственность.'
  },
  '/privacy': {
    title: 'Политика обработки персональных данных — CODE QR PRO',
    description: 'Какие персональные данные обрабатывает CODE QR PRO, с какими целями, кому передаёт и как реализовать права субъекта данных.'
  }
};

function ensureMeta(attr, key) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
}

function setIfChanged(el, attr, value) {
  if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
}

/**
 * SEO для публичных страниц. extra позволяет задать title/description
 * для динамических страниц (например, статьи базы знаний).
 */
export function applySeo(path = '/', extra = {}) {
  const clean = String(path || '/').split('?')[0] || '/';
  const isHome = clean === '/';
  const isApp = clean === '/app' || clean.startsWith('/app/');
  const isAuth = clean === '/login' || clean === '/register';
  const isArticle = clean.startsWith('/articles/');
  const publicPage = PUBLIC_PAGES[clean];
  const isPublic = isHome || Boolean(publicPage) || isArticle;

  const fallbackTitle = isApp
    ? 'CODE QR PRO — личный кабинет'
    : (isAuth ? (clean === '/login' ? 'Вход в личный кабинет — CODE QR PRO' : 'Регистрация — CODE QR PRO') : 'Страница не найдена — CODE QR PRO');
  const fallbackDescription = isApp
    ? 'Личный кабинет CODE QR PRO: генерация и печать этикеток «Честного ЗНАКа».'
    : (isAuth ? 'Вход и регистрация в сервисе маркировки CODE QR PRO.' : 'Запрошенная страница не найдена.');

  const title = extra.title || (isHome ? HOME.title : (publicPage ? publicPage.title : fallbackTitle));
  const description = extra.description || (isHome ? HOME.description : (publicPage ? publicPage.description : fallbackDescription));
  const indexable = isPublic && !isAuth;
  document.title = title;

  setIfChanged(ensureMeta('name', 'description'), 'content', description);
  setIfChanged(ensureMeta('name', 'robots'), 'content', indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow');

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  const canonicalUrl = isHome ? `${SITE}/` : `${SITE}${clean}`;
  if (canonical.href !== canonicalUrl) canonical.href = canonicalUrl;

  setIfChanged(ensureMeta('property', 'og:url'), 'content', canonicalUrl);
  setIfChanged(ensureMeta('property', 'og:title'), 'content', title);
  setIfChanged(ensureMeta('property', 'og:description'), 'content', description);
  setIfChanged(ensureMeta('property', 'og:type'), 'content', isArticle ? 'article' : 'website');
  setIfChanged(ensureMeta('name', 'twitter:title'), 'content', title);
  setIfChanged(ensureMeta('name', 'twitter:description'), 'content', description);
}
