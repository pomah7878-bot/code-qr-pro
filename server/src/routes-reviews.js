import { db } from './db.js';
import { requireAuth } from './routes.js';
import { notifyStatusChange } from './notify.js';

const requireAdmin = async (req, reply) => {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Только для администратора' });
};

const pub = (r) => ({ id: r.id, rating: r.rating, text: r.text, authorName: r.author_name || 'Клиент', createdAt: r.created_at });

export async function registerReviewRoutes(app) {
  // Публичный список одобренных отзывов + средний рейтинг
  app.get('/api/reviews', async () => {
    const rows = db.prepare("SELECT * FROM reviews WHERE status='approved' ORDER BY id DESC LIMIT 100").all();
    const agg = db.prepare("SELECT COUNT(*) c, COALESCE(AVG(rating),0) avg FROM reviews WHERE status='approved'").get();
    return { reviews: rows.map(pub), count: agg.c, avgRating: Math.round(agg.avg * 10) / 10 };
  });

  // Свой отзыв (для формы редактирования)
  app.get('/api/reviews/mine', { preHandler: requireAuth }, async (req) => {
    const r = db.prepare('SELECT * FROM reviews WHERE user_id=?').get(req.user.id);
    return { review: r ? { id: r.id, rating: r.rating, text: r.text, authorName: r.author_name, status: r.status } : null };
  });

  // Оставить/обновить отзыв (один на пользователя)
  app.post('/api/reviews', { preHandler: requireAuth }, async (req, reply) => {
    const { rating, text, authorName } = req.body || {};
    const rt = Math.round(Number(rating));
    if (!Number.isFinite(rt) || rt < 1 || rt > 5) return reply.code(400).send({ error: 'Оценка от 1 до 5' });
    const txt = String(text || '').trim();
    if (txt.length < 10) return reply.code(400).send({ error: 'Отзыв минимум 10 символов' });
    if (txt.length > 2000) return reply.code(400).send({ error: 'Отзыв до 2000 символов' });
    const name = String(authorName || req.user.name || '').trim().slice(0, 60);
    const existing = db.prepare('SELECT id FROM reviews WHERE user_id=?').get(req.user.id);
    // повторный отзыв снова уходит на модерацию
    if (existing) {
      db.prepare("UPDATE reviews SET rating=?, text=?, author_name=?, status='pending', updated_at=datetime('now') WHERE id=?")
        .run(rt, txt, name, existing.id);
    } else {
      db.prepare('INSERT INTO reviews (user_id, rating, text, author_name) VALUES (?,?,?,?)').run(req.user.id, rt, txt, name);
    }
    notifyStatusChange(req.user, 'Новый отзыв на модерации: ' + rt + '★ — ' + txt.slice(0, 80));
    return { ok: true, status: 'pending' };
  });

  // Удалить свой отзыв
  app.delete('/api/reviews/:id', { preHandler: requireAuth }, async (req, reply) => {
    const r = db.prepare('SELECT * FROM reviews WHERE id=?').get(req.params.id);
    if (!r) return reply.code(404).send({ error: 'Отзыв не найден' });
    if (r.user_id !== req.user.id && req.user.role !== 'admin') return reply.code(403).send({ error: 'Нет доступа' });
    db.prepare('DELETE FROM reviews WHERE id=?').run(r.id);
    return { ok: true };
  });

  // Админ: все отзывы
  app.get('/api/admin/reviews', { preHandler: requireAdmin }, async () => ({
    reviews: db.prepare('SELECT r.*, u.email FROM reviews r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 200').all()
  }));

  // Админ: модерация (approve/hide)
  app.post('/api/admin/reviews/:id/moderate', { preHandler: requireAdmin }, async (req, reply) => {
    const { status } = req.body || {};
    if (!['approved', 'hidden', 'pending'].includes(status)) return reply.code(400).send({ error: 'Статус: approved/hidden/pending' });
    const r = db.prepare('SELECT * FROM reviews WHERE id=?').get(req.params.id);
    if (!r) return reply.code(404).send({ error: 'Отзыв не найден' });
    db.prepare('UPDATE reviews SET status=? WHERE id=?').run(status, r.id);
    return { ok: true };
  });
}
