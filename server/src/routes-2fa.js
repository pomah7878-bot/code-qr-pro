import bwipjs from 'bwip-js';
import { db } from './db.js';
import { verifyPassword, createSession, publicUser, sessionDaysFor } from './auth.js';
import { requireAuth } from './routes.js';
import {
  generateSecret, verifyTotp, otpauthUrl, generateBackupCodes, hashBackupCodes, consumeBackupCode
} from './lib/totp.js';
import { readTicket, countAttempt, clearTicket } from './lib/twofa-ticket.js';
import { audit } from './lib/audit.js';
import { encryptSecret, decryptSecret } from './lib/secrets.js';

const COOKIE = 'cq_session';
const cookieOpts = (expires) => ({
  path: '/', httpOnly: true, sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  expires
});

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);

export async function registerTwoFactorRoutes(app) {
  // Шаг 1: секрет и QR, 2FA ещё не включена
  app.post('/api/auth/2fa/setup', { preHandler: requireAuth }, async (req, reply) => {
    const user = getUser(req.user.id);
    if (user.totp_enabled) return reply.code(400).send({ error: 'Двухфакторная аутентификация уже включена' });
    const secret = generateSecret();
    db.prepare('UPDATE users SET totp_secret=? WHERE id=?').run(encryptSecret(secret), user.id);
    const otpauth = otpauthUrl(secret, user.email);
    const png = await bwipjs.toBuffer({
      bcid: 'qrcode', text: otpauth, scale: 4, paddingwidth: 8, paddingheight: 8
    });
    return {
      secret,
      otpauth,
      qr: 'data:image/png;base64,' + png.toString('base64')
    };
  });

  // Шаг 2: подтверждение кода и выдача резервных кодов
  app.post('/api/auth/2fa/enable', { preHandler: requireAuth }, async (req, reply) => {
    const user = getUser(req.user.id);
    if (user.totp_enabled) return reply.code(400).send({ error: 'Двухфакторная аутентификация уже включена' });
    if (!user.totp_secret) return reply.code(400).send({ error: 'Сначала запустите настройку 2FA' });
    if (!verifyTotp(decryptSecret(user.totp_secret), req.body?.code)) {
      return reply.code(400).send({ error: 'Код не подходит. Проверьте время на устройстве.' });
    }
    const backupCodes = generateBackupCodes(10);
    db.prepare('UPDATE users SET totp_enabled=1, totp_backup=? WHERE id=?')
      .run(JSON.stringify(hashBackupCodes(backupCodes)), user.id);
    audit(req, '2fa.enable', 'user', String(user.id), {});
    return { ok: true, backupCodes };
  });

  app.post('/api/auth/2fa/disable', { preHandler: requireAuth }, async (req, reply) => {
    const user = getUser(req.user.id);
    if (!user.totp_enabled) return reply.code(400).send({ error: 'Двухфакторная аутентификация не включена' });
    if (!req.body?.password || !verifyPassword(String(req.body.password), user.password_hash)) {
      return reply.code(400).send({ error: 'Пароль указан неверно' });
    }
    const code = String(req.body?.code || '').trim();
    const backupLeft = consumeBackupCode(user.totp_backup, code);
    if (!verifyTotp(decryptSecret(user.totp_secret), code) && !backupLeft) {
      return reply.code(400).send({ error: 'Код или резервный код не подходит' });
    }
    db.prepare("UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup='[]' WHERE id=?").run(user.id);
    audit(req, '2fa.disable', 'user', String(user.id), {});
    return { ok: true };
  });

  // Шаг 2 входа: тикет из /api/auth/login + код
  app.post('/api/auth/2fa/challenge', async (req, reply) => {
    const ticket = readTicket(req.body?.ticket);
    if (!ticket) return reply.code(401).send({ error: 'Сессия входа истекла — начните заново' });
    if (countAttempt(ticket.n) > 5) {
      clearTicket(ticket.n);
      return reply.code(429).send({ error: 'Слишком много попыток. Войдите заново.' });
    }
    const user = getUser(ticket.uid);
    if (!user || !user.totp_enabled || user.status === 'blocked') {
      return reply.code(401).send({ error: 'Вход недоступен' });
    }
    const code = String(req.body?.code || '').trim();
    let ok = verifyTotp(decryptSecret(user.totp_secret), code);
    if (!ok) {
      const left = consumeBackupCode(user.totp_backup, code);
      if (left) {
        db.prepare('UPDATE users SET totp_backup=? WHERE id=?').run(left, user.id);
        ok = true;
      }
    }
    if (!ok) return reply.code(401).send({ error: 'Неверный код' });

    clearTicket(ticket.n);
    db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(user.id);
    const { token, expires } = createSession(user.id, {
      ip: req.ip, ua: req.headers['user-agent'], days: sessionDaysFor(user.role)
    });
    reply.setCookie(COOKIE, token, cookieOpts(new Date(expires)));
    req.user = user;
    audit(req, 'auth.2fa.login', 'user', String(user.id), {});
    return { user: publicUser(user) };
  });
}
