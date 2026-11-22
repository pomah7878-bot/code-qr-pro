// Лёгкий трекер публичных страниц без внешних счётчиков.
// visitor — долгоживущий ID в localStorage, session — вкладка/сессия в sessionStorage.
const VISITOR_KEY = 'cq_visitor_id';
const SESSION_KEY = 'cq_session_id';

function randomId(prefix) {
  const raw = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
    ? globalThis.crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + raw.slice(0, 24);
}

function getVisitor() {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) { v = randomId('v'); localStorage.setItem(VISITOR_KEY, v); }
    return v;
  } catch { return ''; }
}

function getSession() {
  try {
    let s = sessionStorage.getItem(SESSION_KEY);
    if (!s) { s = randomId('s'); sessionStorage.setItem(SESSION_KEY, s); }
    return s;
  } catch { return ''; }
}

const ATTR_KEY = 'cq_attribution_v1';
const ATTR_TTL = 90 * 24 * 60 * 60 * 1000;

function deriveAttribution() {
  const out = { source: 'direct', medium: 'none', campaign: '', landing: location.pathname || '/' };
  try {
    const q = new URLSearchParams(location.search);
    const utmSource = String(q.get('utm_source') || '').trim().toLowerCase().slice(0, 80);
    if (utmSource) {
      out.source = utmSource;
      out.medium = String(q.get('utm_medium') || 'cpc').trim().toLowerCase().slice(0, 80);
      out.campaign = String(q.get('utm_campaign') || '').trim().toLowerCase().slice(0, 120);
      return out;
    }
    const ref = String(document.referrer || '');
    if (ref) {
      const host = new URL(ref).hostname.replace(/^www\./, '').toLowerCase();
      if (host && host !== location.hostname) {
        if (/yandex|google|bing|mail\.ru|duckduckgo|dzen/.test(host)) { out.source = host.includes('yandex') ? 'yandex' : host.includes('google') ? 'google' : host; out.medium = 'organic'; }
        else { out.source = host.slice(0, 80); out.medium = 'referral'; }
      }
    }
  } catch { /* ignore */ }
  return out;
}

export function getAttribution() {
  try {
    const raw = localStorage.getItem(ATTR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Date.now() - Number(parsed.at || 0) < ATTR_TTL) return parsed;
    }
    const value = { ...deriveAttribution(), at: Date.now() };
    localStorage.setItem(ATTR_KEY, JSON.stringify(value));
    return value;
  } catch { return { source: 'direct', medium: 'none', campaign: '', landing: '/' }; }
}

let firstSend = true;

export function trackPageview(fullPath = '/') {
  try {
    getAttribution();
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1') return;
    const path = String(fullPath || '/');
    if (path.startsWith('/app')) return;
    const payload = {
      path,
      referrer: firstSend ? String(document.referrer || '') : '',
      sessionId: getSession(),
      visitorId: getVisitor(),
      width: window.innerWidth || 0
    };
    firstSend = false;
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/collect', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/analytics/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* аналитика не должна мешать странице */ }
}
