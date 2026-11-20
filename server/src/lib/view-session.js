import { randomBytes } from 'node:crypto';
import { db } from '../db.js';

/**
 * Просмотр «как клиент»: отдельная cookie `cq_view`, которая даёт только
 * чтение и не сбрасывает админскую сессию. Живёт 30 минут.
 */

export const VIEW_COOKIE = 'cq_view';
const TTL_MINUTES = 30;

export function createViewSession(adminId, userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = db.prepare(`SELECT datetime('now', '+${TTL_MINUTES} minutes') t`).get().t;
  db.transaction(() => {
    db.prepare("DELETE FROM view_sessions WHERE expires_at <= datetime('now')").run();
    db.prepare('INSERT INTO view_sessions (token, admin_id, user_id, expires_at) VALUES (?,?,?,?)')
      .run(token, adminId, userId, expiresAt);
  })();
  return { token, expiresAt };
}

export function getViewSession(token) {
  const value = String(token || '');
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  return db.prepare("SELECT * FROM view_sessions WHERE token=? AND expires_at > datetime('now')").get(value) || null;
}

export function destroyViewSession(token) {
  const value = String(token || '');
  if (value) db.prepare('DELETE FROM view_sessions WHERE token=?').run(value);
}
