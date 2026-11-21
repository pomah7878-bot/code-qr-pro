import { getSetting, setSetting } from '../settings.js';
import { today } from '../db.js';

/**
 * Интеграция с Яндекс.Вебмастером (API v4).
 * Пользователь вставляет OAuth-токен, полученный для приложения Вебмастера;
 * хост определяется автоматически по домену либо задаётся вручную.
 */

const API = 'https://api.webmaster.yandex.net/v4';
const HOST_MATCH = /code-qr\.stockcity\.ru/i;

async function wmFetch(path, token, { method = 'GET' } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'OAuth ' + String(token || '').trim(), Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    const reason = (data && (data.error_description || data.message || data.error)) || String(text || '').slice(0, 200);
    const e = new Error(`Вебмастер: HTTP ${res.status}${reason ? ' — ' + reason : ''}`);
    e.statusCode = res.status;
    throw e;
  }
  return data;
}

export function webmasterConfigured() {
  return Boolean(getSetting('webmaster_token', '') && getSetting('webmaster_host_id', ''));
}

export function webmasterSnapshot() {
  try {
    const raw = getSetting('webmaster_snapshot', '');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function webmasterStatus() {
  return {
    configured: webmasterConfigured(),
    clientId: getSetting('webmaster_client_id', ''),
    hostId: getSetting('webmaster_host_id', ''),
    userId: getSetting('webmaster_user_id', ''),
    lastSyncAt: getSetting('webmaster_last_sync', ''),
    tokenSet: Boolean(getSetting('webmaster_token', ''))
  };
}

export const WEBMASTER_REDIRECT_URI = 'https://code-qr.stockcity.ru/app/admin/analytics';
export const WEBMASTER_SCOPE = 'webmaster:hostinfo';

/** Проверка токена: возвращает user_id и список хостов. */
export async function resolveWebmaster(token, hostId = '') {
  const user = await wmFetch('/user/', token);
  const userId = String(user.user_id || '');
  if (!userId) throw new Error('Вебмастер не вернул user_id — проверьте токен');
  const hosts = await wmFetch(`/user/${encodeURIComponent(userId)}/hosts/`, token);
  const list = Array.isArray(hosts.hosts) ? hosts.hosts : [];
  let picked = list.find((h) => String(h.host_id) === String(hostId)) || null;
  if (!picked) picked = list.find((h) => HOST_MATCH.test(String(h.unicode_host_url || h.host_url || h.ascii_host_url || ''))) || null;
  if (!picked && list.length === 1) picked = list[0];
  return {
    userId,
    host: picked ? { id: String(picked.host_id), url: String(picked.unicode_host_url || picked.host_url || '') } : null,
    hosts: list.map((h) => ({
      id: String(h.host_id),
      url: String(h.unicode_host_url || h.host_url || ''),
      verified: Boolean(h.verified)
    }))
  };
}

export async function saveWebmaster({ token = '', hostId = '', clientId = '' } = {}) {
  if (clientId) {
    const cleanId = String(clientId).trim().slice(0, 200);
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(cleanId)) throw new Error('Client ID выглядит некорректно — скопируйте его из настроек OAuth-приложения Яндекса');
    setSetting('webmaster_client_id', cleanId);
  }
  const current = getSetting('webmaster_token', '');
  const useToken = String(token || current || '').trim();
  if (!useToken) {
    if (clientId) return { ...webmasterStatus(), hosts: [], resolvedHost: null };
    throw new Error('Укажите OAuth-токен Вебмастера');
  }
  const resolved = await resolveWebmaster(useToken, hostId);
  if (token) {
    setSetting('webmaster_token', useToken);
    setSetting('webmaster_snapshot', '');
    setSetting('webmaster_last_sync', '');
  }
  setSetting('webmaster_user_id', resolved.userId);
  if (resolved.host) {
    setSetting('webmaster_host_id', resolved.host.id);
    setSetting('webmaster_host_url', resolved.host.url);
  } else if (hostId) {
    setSetting('webmaster_host_id', String(hostId));
  }
  return { ...webmasterStatus(), hosts: resolved.hosts, resolvedHost: resolved.host };
}

function dateMinus(days) {
  const d = new Date(Date.now() - Math.max(0, Number(days) || 30) * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Загрузка популярных поисковых запросов за период.
 * Сохраняет агрегат за период (клики, показы, средняя позиция).
 */
export async function syncWebmasterQueries(days = 30) {
  const token = getSetting('webmaster_token', '');
  const hostId = getSetting('webmaster_host_id', '');
  const userId = getSetting('webmaster_user_id', '');
  if (!token || !hostId || !userId) throw new Error('Яндекс.Вебмастер не подключён');
  const to = today();
  const from = dateMinus(days);
  const params = new URLSearchParams();
  params.append('order_by', 'TOTAL_SHOWS');
  for (const ind of ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION', 'AVG_CLICK_POSITION']) params.append('query_indicator', ind);
  params.set('date_from', from);
  params.set('date_to', to);
  params.set('limit', '100');
  const data = await wmFetch(
    `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/search-queries/popular?${params.toString()}`,
    token
  );
  const queries = Array.isArray(data.queries) ? data.queries : [];
  const { db } = await import('../db.js');
  const upsert = db.prepare(
    `INSERT INTO seo_queries (engine, query, clicks, impressions, position, date_from, date_to, imported_at)
     VALUES ('yandex',?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(engine, query, date_from, date_to) DO UPDATE SET
       clicks=excluded.clicks, impressions=excluded.impressions, position=excluded.position, imported_at=datetime('now')`
  );
  let saved = 0;
  const tx = db.transaction((rows) => {
    for (const q of rows) {
      const ind = q.indicators || {};
      const text = String(q.query_text || '').trim();
      if (!text) continue;
      upsert.run(
        text.slice(0, 300),
        Number(ind.TOTAL_CLICKS) || 0,
        Number(ind.TOTAL_SHOWS) || 0,
        Number(ind.AVG_SHOW_POSITION ?? ind.AVG_CLICK_POSITION) || 0,
        from,
        to
      );
      saved += 1;
    }
  });
  tx(queries);
  setSetting('webmaster_last_sync', new Date().toISOString());
  return { saved, from, to, total: queries.length };
}

async function safeGet(path, token) {
  try { return { ok: true, data: await wmFetch(path, token) }; }
  catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

/** Дополнительные данные Вебмастера: статистика сайта, диагностика, Sitemap. */
export async function syncWebmasterExtra() {
  const token = getSetting('webmaster_token', '');
  const hostId = getSetting('webmaster_host_id', '');
  const userId = getSetting('webmaster_user_id', '');
  if (!token || !hostId || !userId) throw new Error('Яндекс.Вебмастер не подключён');
  const base = `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}`;
  const [summary, diagnostics, sitemaps] = await Promise.all([
    safeGet(base + '/summary', token),
    safeGet(base + '/diagnostics', token),
    safeGet(base + '/sitemaps', token)
  ]);
  const errors = [];
  if (!summary.ok) errors.push('summary: ' + summary.error);
  if (!diagnostics.ok) errors.push('diagnostics: ' + diagnostics.error);
  if (!sitemaps.ok) errors.push('sitemaps: ' + sitemaps.error);
  const summaryData = summary.ok ? summary.data || {} : {};
  const diagData = diagnostics.ok ? diagnostics.data || {} : {};
  const problems = Object.entries(diagData.problems || {})
    .map(([type, p]) => ({ type, severity: p.severity || '', state: p.state || '', lastStateUpdate: p.last_state_update || '' }))
    .filter((p) => p.state === 'PRESENT')
    .sort((a, b) => {
      const order = { FATAL: 0, CRITICAL: 1, POSSIBLE_PROBLEM: 2, RECOMMENDATION: 3 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    });
  const maps = Array.isArray(sitemaps.ok ? sitemaps.data?.sitemaps : []) ? (sitemaps.data?.sitemaps || []) : [];
  const snapshot = {
    syncedAt: new Date().toISOString(),
    summary: {
      sqi: Number(summaryData.sqi) || 0,
      searchablePages: Number(summaryData.searchable_pages_count) || 0,
      excludedPages: Number(summaryData.excluded_pages_count) || 0,
      problems: summaryData.site_problems || {}
    },
    diagnostics: problems.slice(0, 30),
    sitemaps: {
      count: maps.length,
      urls: maps.reduce((sum, m) => sum + (Number(m.urls_count) || 0), 0),
      errors: maps.reduce((sum, m) => sum + (Number(m.errors_count) || 0), 0),
      lastAccess: maps.map((m) => m.last_access_date).filter(Boolean).sort().slice(-1)[0] || ''
    },
    errors
  };
  setSetting('webmaster_snapshot', JSON.stringify(snapshot));
  return snapshot;
}

export async function testWebmaster() {
  const token = getSetting('webmaster_token', '');
  if (!token) throw new Error('Токен не сохранён');
  const resolved = await resolveWebmaster(token, getSetting('webmaster_host_id', ''));
  return { ok: true, ...resolved };
}
