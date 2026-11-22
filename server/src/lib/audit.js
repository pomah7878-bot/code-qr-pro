import { db } from '../db.js';

// Единая точка записи действий администраторов. Ошибка журнала не ломает запрос.
export function audit(req, action, targetType = '', targetId = '', meta = {}) {
  try {
    db.prepare(`INSERT INTO audit_log
      (actor_id, actor_email, actor_role, action, target_type, target_id, meta, ip)
      VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      req.user?.id || null,
      req.user?.teamMemberEmail || req.user?.email || '',
      req.user?.teamMemberId ? 'team:' + (req.user.teamMemberRole || 'operator') : (req.user?.role || ''),
      String(action).slice(0, 80),
      String(targetType).slice(0, 40),
      String(targetId).slice(0, 60),
      JSON.stringify(meta ?? {}).slice(0, 4000),
      String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].slice(0, 60)
    );
  } catch (e) {
    try { req.log?.warn?.({ err: String(e) }, 'audit write failed'); } catch { /* noop */ }
  }
}
