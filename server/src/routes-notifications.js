import { db } from './db.js';
import { requireAuth } from './routes.js';

export async function registerNotificationRoutes(app) {
  app.get('/api/notifications', { preHandler: requireAuth }, async (req) => {
    const memberId = req.user.teamMemberId || null;
    const unreadOnly = String(req.query?.unread || '') === '1';
    const rows = memberId
      ? db.prepare(`SELECT id, type, title, text, link, read_at, created_at FROM notifications
          WHERE owner_id=? AND member_id=? ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT 100`).all(req.user.id, memberId)
      : db.prepare(`SELECT id, type, title, text, link, read_at, created_at FROM notifications
          WHERE owner_id=? AND member_id IS NULL ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT 100`).all(req.user.id);
    const count = memberId
      ? db.prepare('SELECT COUNT(*) c FROM notifications WHERE owner_id=? AND member_id=? AND read_at IS NULL').get(req.user.id, memberId).c
      : db.prepare('SELECT COUNT(*) c FROM notifications WHERE owner_id=? AND member_id IS NULL AND read_at IS NULL').get(req.user.id).c;
    return { notifications: rows, unread: Number(count) };
  });

  app.post('/api/notifications/read', { preHandler: requireAuth }, async (req) => {
    const memberId = req.user.teamMemberId || null;
    const id = req.body?.id ? Number(req.body.id) : null;
    if (id) {
      memberId
        ? db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND owner_id=? AND member_id=?").run(id, req.user.id, memberId)
        : db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND owner_id=? AND member_id IS NULL").run(id, req.user.id);
    } else {
      memberId
        ? db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE owner_id=? AND member_id=? AND read_at IS NULL").run(req.user.id, memberId)
        : db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE owner_id=? AND member_id IS NULL AND read_at IS NULL").run(req.user.id);
    }
    return { ok: true };
  });
}
