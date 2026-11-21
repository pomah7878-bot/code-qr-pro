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

let firstSend = true;

export function trackPageview(fullPath = '/') {
  try {
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
