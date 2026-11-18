import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { getSetting, setSetting } from '../settings.js';

const setting = (key, env, fallback = '') => getSetting(key, process.env[env] || fallback);

export function smtpConfig() {
  return {
    host: setting('smtp_host', 'SMTP_HOST'),
    port: Number(setting('smtp_port', 'SMTP_PORT', '465')),
    secure: setting('smtp_secure', 'SMTP_SECURE', '1') === '1',
    user: setting('smtp_user', 'SMTP_USER'),
    pass: setting('smtp_pass', 'SMTP_PASS'),
    fromName: setting('smtp_from_name', 'SMTP_FROM_NAME', 'CODE QR PRO'),
    fromEmail: setting('smtp_from_email', 'SMTP_FROM')
  };
}

export const smtpConfigured = () => {
  const c = smtpConfig();
  return Boolean(c.host && c.fromEmail);
};

let cached = null;
function transport() {
  const c = smtpConfig();
  const key = [c.host, c.port, c.secure, c.user, c.pass].join('|');
  if (!cached || cached.key !== key) {
    cached = {
      key,
      t: nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        auth: c.user ? { user: c.user, pass: c.pass } : undefined,
        connectionTimeout: 15000,
        socketTimeout: 20000
      })
    };
  }
  return cached.t;
}

export async function sendMail({ to, subject, text, html }) {
  const c = smtpConfig();
  return transport().sendMail({
    from: `"${c.fromName}" <${c.fromEmail}>`,
    to,
    subject,
    text,
    html
  });
}

export const verifySmtp = () => transport().verify();

// --- Отписка и шаблон письма ---
function unsubSecret() {
  let secret = getSetting('mail_unsub_secret', '');
  if (!secret) {
    secret = randomBytes(24).toString('hex');
    setSetting('mail_unsub_secret', secret);
  }
  return secret;
}

export function unsubscribeToken(userId) {
  const body = Buffer.from(String(userId)).toString('base64url');
  const sig = createHmac('sha256', unsubSecret()).update(body).digest('base64url');
  return body + '.' + sig;
}

export function readUnsubscribeToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', unsubSecret()).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  const id = Number(Buffer.from(body, 'base64url').toString());
  return Number.isFinite(id) && id > 0 ? id : null;
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const publicUrl = () => getSetting('public_url', process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru');

export function renderEmail(text, userId) {
  const link = userId ? `${publicUrl()}/api/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(userId))}` : '';
  const bodyHtml = esc(text).replace(/\r?\n/g, '<br>');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Inter,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:16px;padding:28px">
    <div style="font-weight:800;letter-spacing:.04em;color:#4f46e5;margin-bottom:18px">CODE QR PRO</div>
    <div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <div style="font-size:12px;color:#64748b">
      CODE QR PRO · GS1 DataMatrix и маркировка «Честный ЗНАК»<br>
      ${link ? `<a href="${link}" style="color:#64748b">Отписаться от рассылки</a>` : 'Это тестовое письмо.'}
    </div>
  </div></body></html>`;
  const plain = `${text}\n\n---\nCODE QR PRO${link ? `\nОтписаться: ${link}` : ''}`;
  return { html, text: plain };
}
