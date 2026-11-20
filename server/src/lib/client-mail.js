import { sendMail, smtpConfigured, publicUrl } from './mailer.js';
import { logEvent } from './app-log.js';

/**
 * Письма клиенту от администратора: шаблоны для быстрых ответов
 * («доступ восстановлен», «оплата не прошла» и т.п.) и уведомления
 * о действиях админа. Это сервисные письма — без ссылки «отписаться».
 */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const base = () => publicUrl().replace(/\/$/, '');

export const MAIL_TEMPLATES = [
  { id: 'access_restored', title: 'Доступ восстановлен', subject: 'Доступ к аккаунту CODE QR PRO восстановлен' },
  { id: 'twofa_reset', title: '2FA сброшена', subject: 'Двухфакторная аутентификация отключена администратором' },
  { id: 'password_reset', title: 'Пароль сброшен', subject: 'Пароль CODE QR PRO сброшен администратором' },
  { id: 'premium_granted', title: 'PREMIUM активирован', subject: 'PREMIUM в CODE QR PRO активирован' },
  { id: 'compensation', title: 'Компенсация за инцидент', subject: 'Компенсация: PREMIUM в CODE QR PRO продлён' },
  { id: 'payment_failed', title: 'Оплата не прошла', subject: 'Оплата в CODE QR PRO не прошла' },
  { id: 'account_blocked', title: 'Аккаунт заблокирован', subject: 'Аккаунт CODE QR PRO заблокирован' },
  { id: 'custom', title: 'Своё сообщение', subject: '' }
];

const TEMPLATES = {
  access_restored: (u) => ({
    subject: 'Доступ к аккаунту CODE QR PRO восстановлен',
    text: `Здравствуйте${u.name ? ', ' + u.name : ''}!

Администратор снял ограничение на вход в ваш аккаунт CODE QR PRO.
Войдите с обычным паролем: ${base()}/login

Если вы не запрашивали помощь — ответьте на это письмо.`
  }),
  twofa_reset: (u) => ({
    subject: 'Двухфакторная аутентификация отключена администратором',
    text: `Здравствуйте${u.name ? ', ' + u.name : ''}!

Администратор сбросил двухфакторную аутентификацию в вашем аккаунте CODE QR PRO.
Вход снова доступен по паролю. Все активные сессии завершены.

Пожалуйста, включите 2FA заново: ${base()}/app/security

Если это были не вы — сразу напишите в поддержку.`
  }),
  password_reset: (u) => ({
    subject: 'Пароль CODE QR PRO сброшен администратором',
    text: `Здравствуйте${u.name ? ', ' + u.name : ''}!

Администратор сбросил пароль в вашем аккаунте CODE QR PRO.
Временный пароль вам передаст поддержка. При входе его нужно будет сменить.

Вход: ${base()}/login`
  }),
  premium_granted: (u, vars) => ({
    subject: 'PREMIUM в CODE QR PRO активирован',
    text: `Здравствуйте${u.name ? ', ' + u.name : ''}!

Администратор активировал тариф PREMIUM${vars.until ? ' до ' + vars.until : ''}.
Открыты редактор этикеток, наборы, печать PDF, Print Bridge и API.

В кабинет: ${base()}/app`
  }),
  compensation: (u, vars) => ({
    subject: 'Компенсация: PREMIUM в CODE QR PRO продлён',
    text: `Здравствуйте${u.name ? ', ' + u.name : ''}!

Компенсация за инцидент: PREMIUM продлён на ${vars.days || 3} дн.${vars.until ? ' — до ' + vars.until : ''}.
${vars.reason ? 'Комментарий: ' + vars.reason + '\n' : ''}
В кабинет: ${base()}/app`
  }),
  payment_failed: (u) => ({
    subject: 'Оплата в CODE QR PRO не прошла',
    text: `Здравствуйте${u.name ? ', ' + u.name : ''}!

Платёж не прошёл, подписка не активирована. Обычно причина — лимит карты или отказ банка.
Попробуйте ещё раз: ${base()}/app/billing

Если оплата всё же прошла — ответьте на это письмо, мы проверим.`
  }),
  account_blocked: (u, vars) => ({
    subject: 'Аккаунт CODE QR PRO заблокирован',
    text: `Здравствуйте${u.name ? ', ' + u.name : ''}!

Доступ к аккаунту CODE QR PRO заблокирован администратором.
${vars.reason ? 'Причина: ' + vars.reason + '\n' : ''}
Если считаете блокировку ошибкой — ответьте на это письмо.`
  })
};

export function mailTemplateList() {
  return MAIL_TEMPLATES.map((t) => ({ ...t }));
}

function wrap(text) {
  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Inter,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:16px;padding:28px">
    <div style="font-weight:800;letter-spacing:.04em;color:#4f46e5;margin-bottom:18px">CODE QR PRO</div>
    <div style="font-size:15px;line-height:1.6">${esc(text).replace(/\r?\n/g, '<br>')}</div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <div style="font-size:12px;color:#64748b">CODE QR PRO · сервисное сообщение о вашем аккаунте</div>
  </div></body></html>`;
}

/** Отправка письма клиенту. Бросает ошибку, если SMTP не настроен или отправка не удалась. */
export async function sendClientMessage(user, { template = 'custom', subject = '', text = '', vars = {} } = {}) {
  if (!smtpConfigured()) throw new Error('Почта (SMTP) не настроена — письмо не отправить');
  if (!user?.email) throw new Error('У клиента нет email');
  let payload;
  if (template === 'custom') {
    const s = String(subject || '').trim().slice(0, 200);
    const t = String(text || '').trim().slice(0, 5000);
    if (!s || !t) throw new Error('Заполните тему и текст письма');
    payload = { subject: s, text: t };
  } else {
    const builder = TEMPLATES[template];
    if (!builder) throw new Error('Неизвестный шаблон письма');
    payload = builder(user, vars || {});
  }
  await sendMail({ to: user.email, subject: payload.subject, text: payload.text, html: wrap(payload.text) });
  return { ok: true, subject: payload.subject };
}

/** Уведомление клиента о действии админа: не блокирует действие и не ломает его ошибкой. */
export async function notifyClient(user, template, vars = {}) {
  if (!smtpConfigured()) return false;
  try {
    await sendClientMessage(user, { template, vars });
    return true;
  } catch (e) {
    logEvent({
      level: 'warn',
      source: 'mail',
      event: 'client_notify_failed',
      message: `Не удалось отправить письмо «${template}» на ${user?.email || '—'}: ${String(e?.message || e)}`,
      meta: { template, userId: user?.id ?? null }
    });
    return false;
  }
}

export function renderTemplatePreview(template, user, vars = {}) {
  if (template === 'custom') return null;
  const builder = TEMPLATES[template];
  if (!builder) return null;
  return builder(user || { name: '' }, vars || {});
}
