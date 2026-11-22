import { db } from '../db.js';
import { planDef } from '../plans.js';

export function logActivity(user, kind, title, { status = 'ok', total = 0, ok = 0, fail = 0, meta = {} } = {}) {
  if (!user?.id) return;
  try {
    const days = Math.max(1, Number(planDef(user.plan).historyDays) || 7);
    db.prepare(
      `INSERT INTO activity_log (user_id, kind, title, status, total, ok_count, fail_count, meta, expires_at, member_id, member_name, member_email)
       VALUES (?,?,?,?,?,?,?,?, datetime('now', '+' || ? || ' days'),?,?,?)`
    ).run(
      user.id, String(kind).slice(0, 40), String(title).slice(0, 160), String(status).slice(0, 20),
      Number(total) || 0, Number(ok) || 0, Number(fail) || 0,
      JSON.stringify(meta || {}).slice(0, 4000), days,
      user.teamMemberId || null, String(user.teamMemberName || '').slice(0, 120), String(user.teamMemberEmail || '').slice(0, 160)
    );
  } catch (e) {
    console.error('activity log failed:', e?.message || e);
  }
}
