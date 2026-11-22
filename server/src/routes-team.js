import { randomBytes, createHash } from 'node:crypto';
import { db } from './db.js';
import { requireAuth } from './routes.js';
import { getPlan } from './plans.js';
import { createSession, publicUser, publicWorkspace, hashPassword } from './auth.js';
import { sendMail, publicUrl } from './lib/mailer.js';
import { renderBrandEmail } from './lib/email-template.js';
import { logLogin } from './lib/auth-events.js';
import { audit } from './lib/audit.js';

const COOKIE = 'cq_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_LABEL = { operator: 'Сотрудник', manager: 'Менеджер', viewer: 'Просмотр' };
const acceptAttempts = new Map();

const tokenHash = (token) => createHash('sha256').update(String(token || '')).digest('hex');

function cookieOpts(expires) {
  return {
    path: '/', httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires
  };
}

async function ownerOnly(req, reply) {
  await requireAuth(req, reply);
  if (reply.sent) return false;
  if (req.user?.teamMemberId) {
    reply.code(403).send({ error: 'Командой управляет только владелец аккаунта', code: 'team_member_forbidden' });
    return false;
  }
  if (!['user'].includes(req.user?.role)) {
    reply.code(403).send({ error: 'Для аккаунтов администраторов команда недоступна' });
    return false;
  }
  return true;
}

function seatInfo(owner) {
  const plan = getPlan(owner.plan);
  const limit = Math.max(1, Number(plan?.features?.employees) || 1);
  const used = db.prepare("SELECT COUNT(*) c FROM team_members WHERE owner_id=? AND revoked_at IS NULL AND status IN ('invited','active')").get(owner.id).c;
  return { limit, used, available: Math.max(0, limit - used) };
}

function inviteLink(token) {
  return `${publicUrl()}/team/accept?token=${encodeURIComponent(token)}`;
}

async function sendInviteEmail(member, owner, token) {
  const link = inviteLink(token);
  const brand = renderBrandEmail({
    title: 'Вас пригласили в команду CODE QR PRO',
    badge: 'Командный доступ',
    preheader: `${owner.name || owner.email} приглашает вас в CODE QR PRO`,
    intro: `Владелец аккаунта ${owner.name || owner.email} приглашает вас в команду CODE QR PRO.\n\nРоль: ${ROLE_LABEL[member.role] || member.role}.\nПерейдите по ссылке и задайте пароль для личного входа. Ссылка действует 7 дней.`,
    notice: 'Если вы не ожидали приглашение — просто проигнорируйте письмо.',
    noticeTone: 'warn',
    ctaLabel: 'Принять приглашение',
    ctaUrl: link
  });
  await sendMail({
    to: member.email,
    subject: 'Приглашение в команду CODE QR PRO',
    text: brand.text,
    html: brand.html
  });
  return link;
}

export async function registerTeamRoutes(app) {
  app.get('/api/team', { preHandler: ownerOnly }, async (req) => {
    const owner = req.user;
    const seats = seatInfo(owner);
    const rows = db.prepare(`SELECT id, user_id, email, name, role, status, created_at, last_login_at, expires_at
      FROM team_members WHERE owner_id=? AND revoked_at IS NULL ORDER BY id DESC`).all(owner.id);
    return {
      seats,
      members: rows.map((m) => ({
        id: m.id, email: m.email, name: m.name, role: m.role, roleLabel: ROLE_LABEL[m.role] || m.role,
        status: m.status, hasAccount: Boolean(m.user_id), createdAt: m.created_at, lastLoginAt: m.last_login_at, expiresAt: m.expires_at
      }))
    };
  });

  app.get('/api/team/activity', { preHandler: ownerOnly }, async (req) => {
    const owner = req.user;
    const jobs = db.prepare(`SELECT id, name, status, created_at, created_by_name, created_by_email
      FROM generation_jobs WHERE user_id=? AND deleted_at IS NULL AND created_by_member_id IS NOT NULL ORDER BY id DESC LIMIT 20`).all(owner.id)
      .map((j) => ({ type: 'job', id: j.id, title: j.name, status: j.status, createdAt: j.created_at, actor: j.created_by_name || j.created_by_email }));
    const acts = db.prepare(`SELECT id, kind, title, status, created_at, member_name, member_email
      FROM activity_log WHERE user_id=? AND member_id IS NOT NULL ORDER BY id DESC LIMIT 20`).all(owner.id)
      .map((a) => ({ type: 'activity', id: a.id, title: a.title || a.kind, status: a.status, createdAt: a.created_at, actor: a.member_name || a.member_email }));
    const items = [...jobs, ...acts].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30);
    return { items };
  });

  app.post('/api/team/invite', { preHandler: ownerOnly }, async (req, reply) => {
    const owner = req.user;
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 160);
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const role = req.body?.role === 'viewer' ? 'viewer' : req.body?.role === 'manager' ? 'manager' : 'operator';
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'Некорректный email' });
    if (email === String(owner.email || '').toLowerCase()) return reply.code(400).send({ error: 'Нельзя пригласить владельца аккаунта' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return reply.code(409).send({ error: 'Этот email уже зарегистрирован. Используйте другой.' });
    const seats = seatInfo(owner);
    if (seats.available <= 0) {
      return reply.code(409).send({ error: `Лимит сотрудников на тарифе ${owner.plan.toUpperCase()}: ${seats.limit}. Освободите место или смените тариф.`, code: 'team_seats_exhausted' });
    }
    const existing = db.prepare("SELECT id FROM team_members WHERE owner_id=? AND lower(email)=? AND revoked_at IS NULL AND status IN ('invited','active')").get(owner.id, email);
    if (existing) return reply.code(409).send({ error: 'Этот сотрудник уже приглашён' });
    const token = randomBytes(24).toString('hex');
    const id = db.prepare(`INSERT INTO team_members (owner_id, email, name, role, token_hash, status, expires_at)
      VALUES (?,?,?,?,?, 'invited', datetime('now','+7 days'))`).run(owner.id, email, name, role, tokenHash(token)).lastInsertRowid;
    const member = { id, email, name, role };
    let emailSent = false;
    let link = inviteLink(token);
    try {
      link = await sendInviteEmail(member, owner, token);
      emailSent = true;
    } catch (e) {
      req.log?.warn?.({ err: String(e) }, 'team invite email failed');
    }
    audit(req, 'team.invite', 'team_member', String(id), { email, role, emailSent });
    return { ok: true, emailSent, member, link, seats: seatInfo(owner) };
  });

  app.post('/api/team/members/:id/reinvite', { preHandler: ownerOnly }, async (req, reply) => {
    const owner = req.user;
    const member = db.prepare('SELECT * FROM team_members WHERE id=? AND owner_id=? AND revoked_at IS NULL').get(Number(req.params.id), owner.id);
    if (!member) return reply.code(404).send({ error: 'Сотрудник не найден' });
    if (member.user_id && member.status === 'active') {
      return reply.code(409).send({ error: 'Сотрудник уже активировал личный вход. Для смены пароля используйте «Забыли пароль» на странице входа.' });
    }
    const token = randomBytes(24).toString('hex');
    const nextStatus = member.status === 'active' ? 'active' : 'invited';
    db.prepare("UPDATE team_members SET token_hash=?, status=?, expires_at=datetime('now','+7 days') WHERE id=?").run(tokenHash(token), nextStatus, member.id);
    let emailSent = false;
    let link = inviteLink(token);
    try { link = await sendInviteEmail({ ...member }, owner, token); emailSent = true; } catch (e) { req.log?.warn?.({ err: String(e) }, 'team reinvite email failed'); }
    audit(req, 'team.reinvite', 'team_member', String(member.id), { email: member.email });
    return { ok: true, emailSent, link };
  });

  app.delete('/api/team/members/:id', { preHandler: ownerOnly }, async (req, reply) => {
    const owner = req.user;
    const member = db.prepare('SELECT * FROM team_members WHERE id=? AND owner_id=? AND revoked_at IS NULL').get(Number(req.params.id), owner.id);
    if (!member) return reply.code(404).send({ error: 'Сотрудник не найден' });
    db.transaction(() => {
      if (member.user_id) db.prepare("UPDATE users SET status='blocked', owner_id=NULL, member_role='' WHERE id=?").run(member.user_id);
      db.prepare("UPDATE team_members SET status='revoked', revoked_at=datetime('now') WHERE id=?").run(member.id);
      db.prepare('DELETE FROM sessions WHERE team_member_id=?').run(member.id);
    })();
    audit(req, 'team.revoke', 'team_member', String(member.id), { email: member.email });
    return { ok: true };
  });

  app.get('/api/team/invite/:token', async (req, reply) => {
    const hash = tokenHash(req.params.token);
    const member = db.prepare(`SELECT m.id, m.email, m.name, m.role, m.expires_at, u.name owner_name, u.email owner_email
      FROM team_members m JOIN users u ON u.id=m.owner_id
      WHERE m.token_hash=? AND m.status IN ('invited','active') AND m.revoked_at IS NULL`).get(hash);
    if (!member) return reply.code(404).send({ error: 'Приглашение не найдено или уже использовано' });
    const valid = db.prepare("SELECT ? > datetime('now') ok").get(member.expires_at).ok;
    if (!valid) return reply.code(410).send({ error: 'Срок приглашения истёк. Попросите владельца отправить новое.' });
    return {
      email: member.email, name: member.name, role: member.role, roleLabel: ROLE_LABEL[member.role] || member.role,
      ownerName: member.owner_name, ownerEmail: member.owner_email, expiresAt: member.expires_at
    };
  });

  app.post('/api/team/accept', async (req, reply) => {
    const ip = String(req.ip || 'unknown');
    const now = Date.now();
    let bucket = acceptAttempts.get(ip);
    if (!bucket || now - bucket.at > 60_000) { bucket = { n: 0, at: now }; acceptAttempts.set(ip, bucket); }
    bucket.n += 1;
    if (bucket.n > 20) return reply.code(429).send({ error: 'Слишком много попыток. Подождите минуту.' });
    const hash = tokenHash(req.body?.token);
    const member = db.prepare(`SELECT * FROM team_members WHERE token_hash=? AND status IN ('invited','active') AND revoked_at IS NULL`).get(hash);
    if (!member) return reply.code(404).send({ error: 'Приглашение не найдено или уже использовано' });
    if (!db.prepare("SELECT ? > datetime('now') ok").get(member.expires_at).ok) {
      return reply.code(410).send({ error: 'Срок приглашения истёк' });
    }
    const owner = db.prepare("SELECT * FROM users WHERE id=? AND status='active'").get(member.owner_id);
    if (!owner) return reply.code(403).send({ error: 'Аккаунт владельца недоступен' });
    if (req.body?.acceptTerms !== true) return reply.code(400).send({ error: 'Подтвердите принятие условий' });
    const password = String(req.body?.password || '');
    if (password.length < 8) return reply.code(400).send({ error: 'Пароль минимум 8 символов' });
    if (password.length > 200) return reply.code(400).send({ error: 'Слишком длинный пароль' });
    const name = String(req.body?.name || member.name || '').trim().slice(0, 100);
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(member.email);
    if (existing) return reply.code(409).send({ error: 'Email уже зарегистрирован. Войдите в существующий аккаунт или используйте другой email.', code: 'email_exists' });
    const passwordHash = hashPassword(password);
    let userId;
    db.transaction(() => {
      userId = db.prepare("INSERT INTO users (email, password_hash, name, role, plan, status, owner_id, member_role) VALUES (?,?,?,'user','free','active',?,?)")
        .run(member.email, passwordHash, name, owner.id, member.role).lastInsertRowid;
      db.prepare("UPDATE team_members SET user_id=?, status='active', last_login_at=datetime('now'), expires_at=NULL, token_hash=? WHERE id=?")
        .run(userId, randomBytes(24).toString('hex'), member.id);
    })();
    db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(userId);
    const { token, expires } = createSession(owner.id, {
      teamMemberId: member.id, ip: req.ip, ua: req.headers['user-agent'], days: 30
    });
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    logLogin({ userId, email: member.email, ok: true, reason: 'team_accept', ip: req.ip, ua: req.headers['user-agent'] });
    audit({ user: { ...owner, teamMemberId: member.id, teamMemberEmail: member.email, teamMemberRole: member.role }, ip: req.ip, headers: req.headers }, 'team.accept', 'team_member', String(member.id), { email: member.email });
    return { user: publicWorkspace({ ...owner, id: owner.id }, { ...member, user_id: userId }) };
  });
}
