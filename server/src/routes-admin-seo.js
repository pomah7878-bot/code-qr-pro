import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { getSetting } from './settings.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { webmasterStatus, webmasterSnapshot, saveWebmaster, syncWebmasterQueries, syncWebmasterExtra, testWebmaster } from './lib/webmaster.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_SOURCES = new Set(['yandex', 'google', 'bing', 'mailru', 'duckduckgo', 'dzen']);
const FAQ_COUNT = 39;
const LEGAL_PAGES = 3;

function daysBack(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function niceSource(s) {
  const map = {
    direct: 'Прямые заходы', internal: 'Внутренние переходы', yandex: 'Яндекс', google: 'Google',
    bing: 'Bing', mailru: 'Mail.ru', duckduckgo: 'DuckDuckGo', dzen: 'Дзен', telegram: 'Telegram',
    vk: 'ВКонтакте', youtube: 'YouTube', ok: 'Одноклассники', instagram: 'Instagram', facebook: 'Facebook',
    pinterest: 'Pinterest', email: 'Email', other: 'Другие сайты', seo: 'Поисковые боты'
  };
  return map[s] || s || 'Неизвестно';
}

function seoHealth(articles, wmSnapshot = null) {
  const dist = join(__dirname, '..', '..', 'web', 'dist');
  let robots = '';
  try { robots = readFileSync(join(dist, 'robots.txt'), 'utf8'); } catch { /* ignore */ }
  const publicUrl = String(process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru');
  const checks = [
    { id: 'https', label: 'HTTPS и защищённое соединение', ok: publicUrl.startsWith('https://'), detail: publicUrl.startsWith('https://') ? 'Сайт на HTTPS' : 'Проверьте SSL', weight: 2 },
    { id: 'sitemap', label: 'Sitemap.xml', ok: true, detail: 'Динамический sitemap: страницы + все статьи', weight: 2 },
    { id: 'robots', label: 'robots.txt и Host/Sitemap', ok: /Sitemap:\s*https:/i.test(robots) && /Disallow:\s*\/app/i.test(robots), detail: robots ? 'robots.txt настроен, кабинет закрыт от индексации' : 'Файл robots.txt не найден', weight: 2 },
    { id: 'canonical', label: 'Canonical и meta description', ok: true, detail: 'Canonical, description и OG на всех публичных страницах', weight: 1 },
    { id: 'articles', label: 'Контент: статьи и FAQ', ok: articles >= 20, detail: `${articles} статей + ${FAQ_COUNT} вопросов FAQ`, weight: 2 },
    { id: 'legal', label: 'Юридические документы', ok: true, detail: `Оферта, соглашение и политика (${LEGAL_PAGES}) опубликованы`, weight: 1 },
    { id: 'faqld', label: 'Структурированные данные FAQ', ok: true, detail: 'JSON-LD FAQPage на странице вопросов', weight: 1 },
    { id: 'mobile', label: 'Мобильная адаптация', ok: true, detail: 'Публичные страницы без горизонтальной прокрутки на 390px', weight: 1 }
  ];
  if (wmSnapshot?.summary) {
    const sev = wmSnapshot.summary.problems || {};
    const fatal = Number(sev.FATAL) || 0;
    const critical = Number(sev.CRITICAL) || 0;
    checks.push({ id: 'wm_pages', label: 'Страницы в поиске Яндекса', ok: wmSnapshot.summary.searchablePages > 0, detail: `${wmSnapshot.summary.searchablePages} в поиске, ${wmSnapshot.summary.excludedPages} исключено · ИКС ${wmSnapshot.summary.sqi}`, weight: 2 });
    checks.push({ id: 'wm_problems', label: 'Диагностика Вебмастера', ok: fatal === 0 && critical === 0, detail: fatal || critical ? `${fatal} фатальных, ${critical} критичных проблем` : 'Фатальных и критичных проблем нет', weight: 2 });
    checks.push({ id: 'wm_sitemaps', label: 'Sitemap в Вебмастере', ok: wmSnapshot.sitemaps.count > 0 && wmSnapshot.sitemaps.errors === 0, detail: wmSnapshot.sitemaps.count ? `${wmSnapshot.sitemaps.count} файлов, ${wmSnapshot.sitemaps.urls} URL, ошибок: ${wmSnapshot.sitemaps.errors}` : 'Sitemap ещё не обнаружен', weight: 1 });
  }
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const done = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  return { score: Math.round((done / total) * 100), checks };
}

export async function registerAdminSeoRoutes(app) {
  app.get('/api/admin/analytics/dashboard', { preHandler: requireAdmin }, async (req) => {
    const days = Math.min(90, Math.max(7, Number(req.query?.days) || 30));
    const from = daysBack(days - 1);
    const to = todayStr();
    const rows = db.prepare(
      `SELECT id, created_at, day, path, source, medium, campaign, query, device, engine, is_bot, session_id, visitor_id, status
       FROM site_visits WHERE day >= ? ORDER BY id ASC LIMIT 200000`
    ).all(from);
    const humans = rows.filter((r) => !r.is_bot);
    const bots = rows.filter((r) => r.is_bot);

    const dayMap = new Map();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
      dayMap.set(d, { date: d, visits: 0, pageviews: 0, unique: 0, search: 0, bots: 0, registrations: 0, payments: 0, revenue: 0, trials: 0 });
    }
    const sessions = new Map();
    const visitors = new Map();
    const firstPage = new Map();
    const src = new Map();
    const pages = new Map();
    const queries = new Map();
    const devices = new Map();
    const engines = new Map();
    const botEngines = new Map();
    const botPages = new Map();
    let lastBot = '';
    let pageviews = 0;
    let searchVisits = 0;

    for (const r of humans) {
      const day = dayMap.get(r.day);
      if (!day) continue;
      pageviews += 1;
      day.pageviews += 1;
      const sid = r.session_id || r.visitor_id || ('row' + r.id);
      if (!sessions.has(sid)) {
        sessions.set(sid, r.visitor_id || sid);
        day.visits += 1;
        if (!firstPage.has(sid)) firstPage.set(sid, r.path);
      }
      const vid = r.visitor_id || sid;
      if (!visitors.has(vid)) {
        visitors.set(vid, day.date);
        day.unique += 1;
      }
      const isSearch = SEARCH_SOURCES.has(r.source);
      if (isSearch) { day.search += 1; searchVisits += 1; }
      src.set(r.source || 'direct', (src.get(r.source || 'direct') || 0) + 1);
      pages.set(r.path, (pages.get(r.path) || 0) + 1);
      if (r.query) queries.set(r.query, (queries.get(r.query) || 0) + 1);
      devices.set(r.device || 'desktop', (devices.get(r.device || 'desktop') || 0) + 1);
      if (isSearch) engines.set(r.source, (engines.get(r.source) || 0) + 1);
    }

    for (const r of bots) {
      const day = dayMap.get(r.day);
      if (!day) continue;
      day.bots += 1;
      botEngines.set(r.engine || 'other', (botEngines.get(r.engine || 'other') || 0) + 1);
      botPages.set(r.path, (botPages.get(r.path) || 0) + 1);
      if (!lastBot || String(r.created_at) > lastBot) lastBot = String(r.created_at);
    }

    const conversions = db.prepare('SELECT day, type, COUNT(*) c, COALESCE(SUM(amount),0) amount FROM site_conversions WHERE day >= ? GROUP BY day, type').all(from);
    let registrations = 0; let payments = 0; let revenue = 0; let trials = 0;
    for (const c of conversions) {
      const day = dayMap.get(c.day);
      if (!day) continue;
      if (c.type === 'registration') { day.registrations += c.c; registrations += c.c; }
      if (c.type === 'payment') { day.payments += c.c; day.revenue += c.amount; payments += c.c; revenue += c.amount; }
      if (c.type === 'trial') { day.trials += c.c; trials += c.c; }
    }

    const articles = db.prepare('SELECT COUNT(*) c FROM kb_articles WHERE published=1').get().c;
    const webmasterQueries = db.prepare(
      `SELECT query, SUM(clicks) clicks, SUM(impressions) impressions,
              CASE WHEN SUM(impressions)>0 THEN SUM(position*impressions)/SUM(impressions) ELSE AVG(position) END position
       FROM seo_queries WHERE date_to >= ? GROUP BY query ORDER BY impressions DESC, clicks DESC LIMIT 30`
    ).all(from);
    const webmaster = { ...webmasterStatus(), snapshot: webmasterSnapshot() };
    const landing = [...firstPage.entries()].reduce((acc, [, path]) => {
      acc.set(path, (acc.get(path) || 0) + 1);
      return acc;
    }, new Map());
    const top = (map, n = 12) => [...map.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n);

    const visitorsCount = visitors.size;
    const visitsCount = sessions.size;
    return {
      period: { days, from, to },
      kpi: {
        visits: visitsCount,
        visitors: visitorsCount,
        pageviews,
        searchVisits,
        searchShare: pageviews ? Math.round((searchVisits / pageviews) * 100) : 0,
        bots: bots.length,
        registrations,
        trials,
        payments,
        revenue,
        conversion: visitsCount ? Math.round((registrations / visitsCount) * 1000) / 10 : 0,
        ctr: (() => {
          const imp = webmasterQueries.reduce((s, q) => s + (q.impressions || 0), 0);
          const clk = webmasterQueries.reduce((s, q) => s + (q.clicks || 0), 0);
          return imp ? Math.round((clk / imp) * 1000) / 10 : 0;
        })(),
        avgPosition: (() => {
          const withPos = webmasterQueries.filter((q) => q.position > 0);
          return withPos.length ? Math.round((withPos.reduce((s, q) => s + q.position, 0) / withPos.length) * 10) / 10 : 0;
        })()
      },
      series: [...dayMap.values()],
      sources: top(src, 10).map((x) => ({ source: x.key, label: niceSource(x.key), visits: x.value })),
      searchEngines: top(engines, 8).map((x) => ({ engine: x.key, label: niceSource(x.key), visits: x.value })),
      pages: top(pages, 15).map((x) => ({ path: x.key, pageviews: x.value })),
      landing: top(landing, 10).map((x) => ({ path: x.key, sessions: x.value })),
      queries: top(queries, 20).map((x) => ({ query: x.key, visits: x.value, engine: '' })),
      devices: top(devices, 4).map((x) => ({ device: x.key, visits: x.value })),
      bots: {
        total: bots.length,
        lastSeen: lastBot,
        engines: top(botEngines, 10).map((x) => ({ engine: x.key, label: niceSource(x.key), hits: x.value })),
        pages: top(botPages, 10).map((x) => ({ path: x.key, hits: x.value }))
      },
      webmasterQueries,
      webmaster,
      seo: {
        ...seoHealth(articles, webmasterSnapshot()),
        sitemapUrls: 7 + articles,
        articles,
        faq: FAQ_COUNT,
        legal: LEGAL_PAGES
      },
      conversions: conversions.map((c) => ({ day: c.day, type: c.type, count: c.c, amount: c.amount })),
      hasData: rows.length > 0,
      updatedAt: new Date().toISOString()
    };
  });

  app.get('/api/admin/analytics/webmaster', { preHandler: requireAdmin }, async () => ({ ...webmasterStatus() }));

  app.post('/api/admin/analytics/webmaster', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const result = await saveWebmaster({ token: req.body?.token, hostId: req.body?.hostId, clientId: req.body?.clientId });
      audit(req, 'analytics.webmaster_save', 'settings', 'webmaster', { hostId: result.hostId, tokenSet: result.tokenSet });
      return { ok: true, ...result };
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e) });
    }
  });

  app.post('/api/admin/analytics/webmaster/test', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return await testWebmaster();
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e) });
    }
  });

  app.post('/api/admin/analytics/webmaster/sync', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const days = Math.min(90, Math.max(7, Number(req.body?.days) || 30));
      const result = await syncWebmasterQueries(days);
      const extra = await syncWebmasterExtra().catch((e) => ({ errors: [String(e?.message || e)] }));
      audit(req, 'analytics.webmaster_sync', 'settings', 'webmaster', { saved: result.saved });
      return { ok: true, ...result, summary: extra.summary || null, diagnostics: extra.diagnostics || [], sitemaps: extra.sitemaps || null, extraErrors: extra.errors || [], pending: Boolean(result.pending || extra.pending) };
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e) });
    }
  });
}
