import { getPublicKbArticle } from './kb.js';

const SITE = 'https://code-qr.stockcity.ru';

const PAGES = {
  '/': {
    title: 'CODE QR PRO — маркировка «Честный ЗНАК», DataMatrix и печать этикеток',
    description: 'Генерация GS1 DataMatrix, проверка кодов, наборы с КИН, редактор этикеток, печать PDF и из браузера, Print Bridge и API для 1С. FREE, PRO, BUSINESS и ENTERPRISE.'
  },
  '/check': {
    title: 'Проверить код и карточку товара — CODE QR PRO',
    description: 'Бесплатная проверка кода маркировки и карточки товара: GS1 DataMatrix, статус в открытых источниках «Честного ЗНАКа», GTIN, серийный номер, криптоподпись и наличие карточки в Национальном каталоге.'
  },
  '/pricing': {
    title: 'Тарифы и цены — CODE QR PRO',
    description: 'Тарифы FREE, PRO, BUSINESS и ENTERPRISE: операции, расширенные проверки, история, API и печать. Цены за месяц и год.'
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

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function normalize(path) {
  const clean = String(path || '/').split('?')[0].split('#')[0];
  if (clean === '/') return '/';
  return clean.replace(/\/+$/, '');
}

/** Мета публичной страницы; null — не публичная страница. */
export function seoForPath(path) {
  const clean = normalize(path);
  if (clean === '/' || PAGES[clean]) return { ...PAGES[clean] || PAGES['/'], canonical: clean === '/' ? SITE + '/' : SITE + clean };
  if (clean.startsWith('/articles/')) {
    const slug = clean.slice('/articles/'.length);
    let article = null;
    try { article = getPublicKbArticle(slug); } catch { article = null; }
    if (article?.slug) {
      return {
        title: `${article.title} — CODE QR PRO`,
        description: article.summary || 'Статья базы знаний CODE QR PRO.',
        canonical: SITE + '/articles/' + encodeURIComponent(article.slug),
        type: 'article'
      };
    }
  }
  return null;
}

/**
 * Подставляет title/description/canonical/OG в SPA index.html до отдачи роботу.
 * Изначальный index.html содержит canonical на главную — для Yandex это выглядит
 * как дубль всех статей, даже если клиентский JS потом поправит head.
 */
export function injectSeo(html, path) {
  const meta = seoForPath(path);
  if (!meta) return html;
  const title = esc(meta.title);
  const description = esc(meta.description);
  const canonical = esc(meta.canonical);
  const type = meta.type || 'website';
  let out = String(html);
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  out = out.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${description}">`);
  out = out.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${canonical}">`);
  out = out.replace(/<meta\s+property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${title}">`);
  out = out.replace(/<meta\s+property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${description}">`);
  out = out.replace(/<meta\s+property=["']og:url["'][^>]*>/i, `<meta property="og:url" content="${canonical}">`);
  out = out.replace(/<meta\s+property=["']og:type["'][^>]*>/i, `<meta property="og:type" content="${type}">`);
  out = out.replace(/<meta\s+name=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${title}">`);
  out = out.replace(/<meta\s+name=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${description}">`);
  return out;
}
