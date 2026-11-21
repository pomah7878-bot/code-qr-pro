import { db, today } from '../db.js';

/**
 * Первичная аналитика сайта без внешних счётчиков.
 * Храним просмотры публичных страниц и визиты поисковых ботов.
 */

const BOTS = [
  [/yandexbot|yandex\.com\/bots/i, 'yandex'],
  [/googlebot|google-inspectiontool/i, 'google'],
  [/bingbot|msnbot/i, 'bing'],
  [/mail\.ru_bot|mailru/i, 'mailru'],
  [/duckduckbot/i, 'duckduckgo'],
  [/applebot/i, 'apple'],
  [/baiduspider/i, 'baidu'],
  [/ahrefsbot|semrushbot|mj12bot|dotbot|petalbot/i, 'seo-tools'],
  [/bot|crawler|spider/i, 'other']
];

export function detectBot(ua = '') {
  const s = String(ua || '');
  for (const [re, engine] of BOTS) if (re.test(s)) return engine;
  return '';
}

export function detectDevice(ua = '', width = 0) {
  const s = String(ua || '');
  if (/iPad|Tablet|PlayBook|Silk/i.test(s)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(s)) return 'mobile';
  const w = Number(width) || 0;
  if (w > 0 && w < 768) return 'mobile';
  return 'desktop';
}

const SEARCH_ENGINES = [
  { re: /(^|\.)yandex\.(ru|com|by|kz|ua)$/i, engine: 'yandex', query: ['text', 'query'] },
  { re: /(^|\.)google\./i, engine: 'google', query: ['q', 'query'] },
  { re: /(^|\.)bing\.com$/i, engine: 'bing', query: ['q'] },
  { re: /(^|\.)mail\.ru$/i, engine: 'mailru', query: ['q', 'query'] },
  { re: /(^|\.)duckduckgo\.com$/i, engine: 'duckduckgo', query: ['q'] },
  { re: /(^|\.)dzen\.ru$/i, engine: 'dzen', query: ['query', 'q'] },
  { re: /(^|\.)go\.mail\.ru$/i, engine: 'mailru', query: ['q'] }
];

function safeUrl(value) {
  try { return new URL(String(value || '')); } catch { return null; }
}

/** Разбор реферера: поисковик + поисковый запрос + источник/канал. */
export function parseReferrer(referrer = '', siteHost = 'code-qr.stockcity.ru') {
  const out = { source: 'direct', medium: '', query: '', engine: '', referrer: String(referrer || '').slice(0, 500) };
  if (!out.referrer) return out;
  const url = safeUrl(out.referrer);
  if (!url) return out;
  const host = url.hostname.toLowerCase();
  if (host === siteHost || host.endsWith('.' + siteHost)) {
    out.source = 'internal';
    return out;
  }
  const search = SEARCH_ENGINES.find((e) => e.re.test(host));
  if (search) {
    out.source = search.engine;
    out.engine = search.engine;
    out.medium = 'organic';
    for (const key of search.query) {
      const q = url.searchParams.get(key);
      if (q) { out.query = q.slice(0, 200); break; }
    }
    return out;
  }
  const social = [
    [/t\.me|telegram/i, 'telegram'],
    [/vk\.com|vk\.ru/i, 'vk'],
    [/youtube\.com|youtu\.be/i, 'youtube'],
    [/ok\.ru/i, 'ok'],
    [/instagram\.com/i, 'instagram'],
    [/facebook\.com|fb\.me/i, 'facebook'],
    [/dzen\.ru/i, 'dzen'],
    [/pinterest\./i, 'pinterest']
  ];
  const soc = social.find(([re]) => re.test(host));
  if (soc) { out.source = soc[1]; out.medium = 'social'; return out; }
  if (/mail\.|gmail\.|outlook\./i.test(host)) { out.source = 'email'; out.medium = 'email'; return out; }
  out.source = 'other';
  out.medium = 'referral';
  return out;
}

/** UTM и source из query-строки страницы. */
export function parseUtm(path = '') {
  const url = safeUrl('https://code-qr.stockcity.ru' + String(path || '/'));
  if (!url) return { source: '', medium: '', campaign: '' };
  return {
    source: String(url.searchParams.get('utm_source') || '').slice(0, 60),
    medium: String(url.searchParams.get('utm_medium') || '').slice(0, 60),
    campaign: String(url.searchParams.get('utm_campaign') || '').slice(0, 100)
  };
}

export function normalizePath(path = '/') {
  const raw = String(path || '/').split('?')[0].split('#')[0];
  return (raw || '/').slice(0, 300);
}

const PUBLIC_EXACT = new Set(['/', '/pricing', '/articles', '/faq', '/offer', '/terms', '/privacy', '/login', '/register']);
export function isTrackablePage(path = '') {
  const p = String(path || '/').split('?')[0].split('#')[0];
  if (p.startsWith('/app') || p.startsWith('/api') || p.startsWith('/assets') || p.startsWith('/.well-known')) return false;
  if (/\.(png|jpe?g|svg|webp|gif|ico|css|js|map|txt|xml|woff2?)$/i.test(p)) return false;
  if (PUBLIC_EXACT.has(p)) return true;
  return /^\/articles\/[a-z0-9-]{2,120}$/i.test(p);
}

function cleanId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export function recordVisit(payload = {}, req = {}) {
  const path = normalizePath(payload.path);
  if (!isTrackablePage(path)) return false;
  const day = today();
  const ua = String(payload.ua || req.headers?.['user-agent'] || '');
  if (detectBot(ua)) return false; // ботов учитываем отдельным хуком по запросам, не маяком
  const ref = parseReferrer(payload.referrer || '', 'code-qr.stockcity.ru');
  const utm = parseUtm(payload.path || '');
  const source = utm.source || ref.source;
  const medium = utm.medium || ref.medium;
  const sessionId = cleanId(payload.sessionId);
  const visitorId = cleanId(payload.visitorId);
  const device = payload.device ? String(payload.device).slice(0, 20) : detectDevice(ua, payload.width);
  const info = db.prepare(
    `INSERT OR IGNORE INTO site_visits (day, path, referrer, source, medium, campaign, query, device, session_id, visitor_id, user_id, origin)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'live')`
  ).run(
    day, path, ref.referrer, source || 'direct', medium, utm.campaign, ref.query, device,
    sessionId, visitorId, Number(payload.userId) || null
  );
  return info.changes > 0;
}

/** Визит поискового бота: вызывается серверным хуком на GET публичных страниц. */
export function recordBotHit({ path = '/', engine = '', ua = '', status = 200 } = {}) {
  const day = today();
  const p = normalizePath(path);
  if (!isTrackablePage(p)) return false;
  const bot = engine || detectBot(ua);
  if (!bot) return false;
  db.prepare(
    `INSERT INTO site_visits (day, path, source, medium, engine, is_bot, status, origin)
     VALUES (?,?,'seo','bot',?,1,?, 'live')`
  ).run(day, p, bot, Number(status) || 0);
  return true;
}

export function recordConversion(type, userId = null, amount = 0) {
  try {
    db.prepare('INSERT INTO site_conversions (day, type, user_id, amount) VALUES (?,?,?,?)')
      .run(today(), String(type || 'event').slice(0, 40), Number(userId) || null, Number(amount) || 0);
  } catch { /* аналитика не должна ломать бизнес-операции */ }
}

/** Чистка старых событий аналитики (запускается при старте). */
export function pruneAnalytics(days = 730) {
  try {
    db.prepare("DELETE FROM site_visits WHERE day < date('now', ?)").run(`-${Math.max(30, Number(days) || 730)} days`);
    db.prepare("DELETE FROM seo_queries WHERE date_to <> '' AND date_to < date('now', ?)").run(`-${Math.max(30, Number(days) || 730)} days`);
  } catch { /* ignore */ }
}
