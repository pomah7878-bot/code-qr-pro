import { db } from '../db.js';

/**
 * История входов: кто, когда, с какого IP, успешно или нет.
 * Нужна админу для диагностики («почему клиент не может войти») и для
 * расследования подозрительной активности.
 * Храним 90 дней, чистим в index.js.
 */

const cut = (v, max) => String(v ?? '').slice(0, max);

export function logLogin({ userId = null, email = '', ok = true, reason = '', ip = '', ua = '' } = {}) {
  try {
    db.prepare('INSERT INTO login_events (user_id, email, ok, reason, ip, user_agent) VALUES (?,?,?,?,?,?)')
      .run(userId ?? null, cut(email, 200), ok ? 1 : 0, cut(reason, 40), cut(ip, 60), cut(ua, 200));
  } catch { /* журнал не должен ломать вход */ }
}

export function loginEventsFor(userId, limit = 30) {
  try {
    return db.prepare(
      'SELECT ok, reason, ip, user_agent, created_at FROM login_events WHERE user_id=? ORDER BY id DESC LIMIT ?'
    ).all(userId, Math.min(200, Math.max(1, Number(limit) || 30)));
  } catch {
    return [];
  }
}

export function loginEventsByEmail(email, limit = 30) {
  try {
    return db.prepare(
      'SELECT ok, reason, ip, user_agent, created_at FROM login_events WHERE email=? ORDER BY id DESC LIMIT ?'
    ).all(String(email || '').toLowerCase(), Math.min(200, Math.max(1, Number(limit) || 30)));
  } catch {
    return [];
  }
}
