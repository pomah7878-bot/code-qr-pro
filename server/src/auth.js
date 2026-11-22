import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 30;
const ADMIN_SESSION_DAYS = Number(process.env.ADMIN_SESSION_DAYS || 7);
const ADMIN_IDLE_MINUTES = Number(process.env.ADMIN_IDLE_MINUTES || 120);

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createSession(userId, meta = {}) {
  const token = randomBytes(32).toString('hex');
  const publicId = randomBytes(16).toString('hex');
  const days = Number(meta.days) || SESSION_DAYS;
  const expires = new Date(Date.now() + days * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, public_id, user_id, expires_at, ip, user_agent, last_used_at, team_member_id) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'), ?)')
    .run(token, publicId, userId, expires, String(meta.ip || '').slice(0, 60), String(meta.ua || '').slice(0, 200), meta.teamMemberId || null);
  return { token, publicId, expires };
}

export function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.plan, u.status, u.must_change_password, u.totp_enabled, u.created_at,
            u.cz_token,
            s.last_used_at, s.created_at AS session_created_at, s.team_member_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).get(token);
  if (!row) return null;
  if (['admin', 'support'].includes(row.role)) {
    const last = row.last_used_at || row.session_created_at;
    const idle = db.prepare("SELECT datetime(?, '+' || ? || ' minutes') <= datetime('now') AS expired").get(last, ADMIN_IDLE_MINUTES);
    if (idle?.expired) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
  }
  db.prepare("UPDATE sessions SET last_used_at=datetime('now') WHERE token = ?").run(token);
  if (row.team_member_id) {
    const member = db.prepare("SELECT id, owner_id, email, name, role FROM team_members WHERE id=? AND owner_id=? AND status='active' AND revoked_at IS NULL").get(row.team_member_id, row.id);
    if (!member) return null;
    row.teamMemberId = member.id;
    row.teamMemberEmail = member.email;
    row.teamMemberName = member.name;
    row.teamMemberRole = member.role;
  }
  return row;
}

export function sessionDaysFor(role) {
  return ['admin', 'support'].includes(role) ? ADMIN_SESSION_DAYS : SESSION_DAYS;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan,
    status: u.status || 'active',
    mustChangePassword: Boolean(u.must_change_password),
    twoFactorEnabled: Boolean(u.totp_enabled),
    createdAt: u.created_at,
    teamMember: u.teamMemberId ? {
      id: u.teamMemberId, email: u.teamMemberEmail || '', name: u.teamMemberName || '', role: u.teamMemberRole || 'operator'
    } : null
  };
}
