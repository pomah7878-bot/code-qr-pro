import { sendMail, smtpConfigured } from './mailer.js';
import { renderBrandEmail } from './email-template.js';
import { publicUrl, supportEmail } from './public-url.js';
import { logEvent } from './app-log.js';

/**
 * Письма клиенту от администратора: шаблоны для быстрых ответов
 * («доступ восстановлен», «оплата не прошла» и т.п.) и уведомления
 * о действиях админа. Все письма собираются в фирменном шаблоне.
 */

const site = () => publicUrl();

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
  access_restored: () => ({
    subject: 'Доступ к аккаунту CODE QR PRO восстановлен',
    badge: 'Доступ',
    title: 'Доступ восстановлен',
    intro: 'Здравствуйте!\n\nАдминистратор снял ограничение на вход в ваш аккаунт. Можно снова входить с обычным паролем.',
    notice: 'Если вы не запрашивали помощь — просто ответьте на это письмо.',
    ctaLabel: 'Войти в кабинет',
    ctaUrl: `${site()}/login`
  }),
  twofa_reset: () => ({
    subject: 'Двухфакторная аутентификация отключена администратором',
    badge: 'Безопасность',
    title: 'Двухфакторная аутентификация отключена',
    intro: 'Здравствуйте!\n\nАдминистратор сбросил 2FA в вашем аккаунте CODE QR PRO. Вход снова доступен по паролю, все активные сессии завершены.',
    notice: 'Пожалуйста, включите 2FA заново — это займёт минуту.',
    noticeTone: 'warn',
    ctaLabel: 'Включить 2FA',
    ctaUrl: `${site()}/app/security`
  }),
  password_reset: () => ({
    subject: 'Пароль CODE QR PRO сброшен администратором',
    badge: 'Безопасность',
    title: 'Пароль сброшен',
    intro: 'Здравствуйте!\n\nАдминистратор сбросил пароль в вашем аккаунте CODE QR PRO. Временный пароль вам передаст поддержка, при входе его нужно будет сменить.',
    ctaLabel: 'Перейти ко входу',
    ctaUrl: `${site()}/login`
  }),
  premium_granted: (u, vars) => ({
    subject: 'PREMIUM в CODE QR PRO активирован',
    badge: 'PREMIUM',
    title: 'Тариф PREMIUM активирован',
    intro: `Здравствуйте!\n\nАдминистратор активировал тариф PREMIUM${vars.until ? ' до ' + vars.until : ''}. Открыты редактор этикеток, наборы с КИН, печать PDF, Print Bridge и API.`,
    ctaLabel: 'Открыть кабинет',
    ctaUrl: `${site()}/app`
  }),
  compensation: (u, vars) => ({
    subject: 'Компенсация: PREMIUM в CODE QR PRO продлён',
    badge: 'Компенсация',
    title: 'Мы продлили PREMIUM',
    intro: `Здравствуйте!\n\nИзвините за неудобства. PREMIUM продлён на ${vars.days || 3} дн.${vars.until ? ' — до ' + vars.until : ''}.`,
    notice: vars.reason ? `Комментарий: ${vars.reason}` : '',
    ctaLabel: 'Открыть кабинет',
    ctaUrl: `${site()}/app`
  }),
  payment_failed: () => ({
    subject: 'Оплата в CODE QR PRO не прошла',
    badge: 'Оплата',
    title: 'Платёж не прошёл',
    intro: 'Здравствуйте!\n\nПлатёж не прошёл, подписка не активирована. Обычно причина — лимит карты или отказ банка. Попробуйте ещё раз — это занимает минуту.',
    notice: 'Если деньги всё же списались — ответьте на это письмо, мы проверим.',
    noticeTone: 'warn',
    ctaLabel: 'Повторить оплату',
    ctaUrl: `${site()}/app/billing`
  }),
  account_blocked: (u, vars) => ({
    subject: 'Аккаунт CODE QR PRO заблокирован',
    badge: 'Блокировка',
    title: 'Аккаунт заблокирован',
    intro: 'Здравствуйте!\n\nДоступ к аккаунту CODE QR PRO заблокирован администратором.',
    notice: vars.reason ? `Причина: ${vars.reason}` : '',
    noticeTone: 'danger',
    ctaLabel: 'Написать в поддержку',
    ctaUrl: `mailto:${supportEmail()}`
  })
};

export function mailTemplateList() {
  return MAIL_TEMPLATES.map((t) => ({ ...t }));
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
    payload = { subject: s, title: s, badge: 'Сообщение', intro: t, ctaLabel: 'Открыть кабинет', ctaUrl: `${site()}/app` };
  } else {
    const builder = TEMPLATES[template];
    if (!builder) throw new Error('Неизвестный шаблон письма');
    payload = builder(user, vars || {});
  }
  const { html, text: plain } = renderBrandEmail({
    title: payload.title,
    preheader: payload.intro?.split('\n')[0] || payload.subject,
    badge: payload.badge,
    intro: payload.intro,
    notice: payload.notice,
    noticeTone: payload.noticeTone,
    ctaLabel: payload.ctaLabel,
    ctaUrl: payload.ctaUrl,
    secondaryLabel: payload.secondaryLabel,
    secondaryUrl: payload.secondaryUrl
  });
  await sendMail({ to: user.email, subject: payload.subject, text: plain, html });
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

/** HTML письма для предпросмотра в админке (без отправки). */
export function previewClientMessage(user, { template = 'custom', subject = '', text = '', vars = {} } = {}) {
  const builder = template === 'custom' ? null : TEMPLATES[template];
  const payload = builder
    ? builder(user || {}, vars || {})
    : { subject: subject || 'Сообщение', title: subject || 'Сообщение', badge: 'Сообщение', intro: text || '', ctaLabel: 'Открыть кабинет', ctaUrl: `${site()}/app` };
  const rendered = renderBrandEmail({
    title: payload.title,
    preheader: payload.intro,
    badge: payload.badge,
    intro: payload.intro,
    notice: payload.notice,
    noticeTone: payload.noticeTone,
    ctaLabel: payload.ctaLabel,
    ctaUrl: payload.ctaUrl
  });
  return { subject: payload.subject, html: rendered.html, text: rendered.text };
}
