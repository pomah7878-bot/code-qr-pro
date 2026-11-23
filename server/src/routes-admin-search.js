import { db } from './db.js';
import { requireAdmin, like } from './lib/admin.js';

export async function registerAdminSearchRoutes(app) {
  app.get('/api/admin/search', { preHandler: requireAdmin }, async (req) => {
    const q = String(req.query?.q || '').trim().slice(0, 120);
    if (q.length < 2) return { q, users: [], orders: [], tickets: [], jobs: [] };
    const p = like(q);
    const users = db.prepare('SELECT id,email,name,plan,status FROM users WHERE email LIKE ? ESCAPE \'\\\' OR name LIKE ? ESCAPE \'\\\' ORDER BY id DESC LIMIT 6').all(p, p);
    const orders = db.prepare("SELECT o.id,o.amount,o.status,o.invoice_number,o.company_name,u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE CAST(o.id AS TEXT)=? OR o.invoice_number LIKE ? ESCAPE '\\' OR o.company_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' ORDER BY o.id DESC LIMIT 6").all(q, p, p, p);
    const tickets = db.prepare("SELECT t.id,t.subject,t.status,u.email FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE CAST(t.id AS TEXT)=? OR t.subject LIKE ? ESCAPE '\\' OR t.message LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' ORDER BY t.id DESC LIMIT 6").all(q, p, p, p);
    const jobs = db.prepare("SELECT j.id,j.name,j.status,j.created_at,u.email FROM generation_jobs j JOIN users u ON u.id=j.user_id WHERE CAST(j.id AS TEXT)=? OR j.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' ORDER BY j.id DESC LIMIT 6").all(q, p, p);
    return { q, users, orders, tickets, jobs };
  });
}
