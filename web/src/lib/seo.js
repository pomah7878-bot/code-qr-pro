const SITE = 'https://code-qr.stockcity.ru';
const HOME = {
  title: 'CODE QR PRO — маркировка «Честный ЗНАК», DataMatrix и печать этикеток',
  description: 'Генерация GS1 DataMatrix, проверка кодов, наборы с КИН, редактор этикеток, печать PDF и из браузера, Print Bridge и API для 1С. FREE и PREMIUM.'
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

export function applySeo(path = '/') {
  const clean = path.split('?')[0] || '/';
  const isHome = clean === '/';
  const noindex = clean.startsWith('/app') || clean === '/login' || clean === '/register';
  const titles = {
    '/login': 'Вход в личный кабинет — CODE QR PRO',
    '/register': 'Регистрация — CODE QR PRO'
  };
  const title = isHome ? HOME.title : (titles[clean] || 'CODE QR PRO — личный кабинет');
  const description = isHome ? HOME.description : 'Личный кабинет CODE QR PRO: генерация и печать этикеток «Честного ЗНАКа».';
  document.title = title;
  ensureMeta('name', 'description').setAttribute('content', description);
  ensureMeta('name', 'robots').setAttribute('content', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = isHome ? `${SITE}/` : `${SITE}${clean}`;

  const ogUrl = ensureMeta('property', 'og:url');
  ogUrl.setAttribute('content', canonical.href);
  const ogTitle = ensureMeta('property', 'og:title');
  ogTitle.setAttribute('content', title);
}
