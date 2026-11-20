import { getSetting } from '../settings.js';
import { publicUrl, supportEmail } from './public-url.js';

/**
 * Фирменный шаблон писем CODE QR PRO.
 *
 * Вёрстка таблицами и inline-стилями — так письмо одинаково выглядит в Gmail,
 * Яндекс.Почте, Mail.ru, Outlook и Apple Mail. Есть тёмная тема для клиентов,
 * которые её поддерживают, и текстовая версия для остальных.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const BRAND = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  bg: '#eef1f8',
  soft: '#eef2ff'
};

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p class="em-text" style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BRAND.body}">${esc(p.trim()).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

function button(label, url) {
  if (!label || !url) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px">
    <tr>
      <td align="center" bgcolor="${BRAND.indigo}" style="border-radius:12px;background-color:${BRAND.indigo};background-image:linear-gradient(90deg,${BRAND.indigo},${BRAND.violet})">
        <a href="${esc(url)}" target="_blank" rel="noopener"
           style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;letter-spacing:.01em">
          ${esc(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/** Шапка: растровый логотип (по умолчанию) или CSS-марка, если логотип отключён. */
function brandMark(site) {
  const mode = String(getSetting('email_logo_mode', 'image') || 'image');
  const logo = getSetting('email_logo_url', '') || `${site}/icon-192.png`;
  if (mode !== 'mark') {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="44" style="width:44px">
      <tr>
        <td align="center" valign="middle" width="44" height="44" style="width:44px;height:44px;text-align:center;vertical-align:middle">
          <img src="${esc(logo)}" width="44" height="44" alt="QR"
               style="display:block;width:44px;height:44px;border:0;border-radius:12px;outline:none;color:${BRAND.indigo};font-family:${FONT};font-size:15px;font-weight:800;text-align:center">
        </td>
      </tr>
    </table>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="44" style="width:44px">
    <tr>
      <td align="center" valign="middle" width="44" height="44" bgcolor="${BRAND.indigo}"
          style="width:44px;height:44px;background-color:${BRAND.indigo};background-image:linear-gradient(135deg,${BRAND.indigo},${BRAND.violet});border-radius:12px;text-align:center;vertical-align:middle">
        <span style="font-family:${FONT};font-size:15px;font-weight:800;color:#ffffff;letter-spacing:.5px">QR</span>
      </td>
    </tr>
  </table>`;
}

export function renderBrandEmail({
  title = 'CODE QR PRO',
  preheader = '',
  badge = '',
  intro = '',
  bodyHtml = '',
  code = '',
  notice = '',
  noticeTone = 'info',
  ctaLabel = '',
  ctaUrl = '',
  secondaryLabel = '',
  secondaryUrl = '',
  footerNote = '',
  unsubscribeUrl = '',
  logoUrl = '',
  brandUrl = ''
} = {}) {
  const site = brandUrl || publicUrl();
  const support = supportEmail();
  const tone = noticeTone === 'warn'
    ? { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412' }
    : noticeTone === 'danger'
      ? { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' }
      : { bg: BRAND.soft, border: '#c7d2fe', text: '#3730a3' };

  const mark = logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="44" style="width:44px"><tr><td align="center" valign="middle" width="44" height="44" bgcolor="${BRAND.indigo}" style="width:44px;height:44px;background-color:${BRAND.indigo};border-radius:12px"><img src="${esc(logoUrl)}" width="44" height="44" alt="QR" style="display:block;width:44px;height:44px;border:0;border-radius:12px;color:#ffffff;font-family:${FONT};font-size:15px;font-weight:800"></td></tr></table>`
    : brandMark(site);

  const codeBlock = code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px">
        <tr>
          <td class="em-code" align="center" style="padding:18px 12px;background:#f8fafc;border:1px solid ${BRAND.line};border-radius:14px">
            <span style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND.ink}">${esc(code)}</span>
          </td>
        </tr>
      </table>`
    : '';

  const badgeHtml = badge
    ? `<span class="em-badge" style="display:inline-block;padding:5px 12px;border-radius:999px;background:${BRAND.soft};color:${BRAND.indigo};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${esc(badge)}</span>`
    : '';

  const noticeHtml = notice
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px">
        <tr>
          <td class="em-note" style="padding:12px 14px;background:${tone.bg};border:1px solid ${tone.border};border-radius:12px;font-family:${FONT};font-size:13px;line-height:1.55;color:${tone.text}">
            ${esc(notice).replace(/\r?\n/g, '<br>')}
          </td>
        </tr>
      </table>`
    : '';

  const secondary = secondaryLabel && secondaryUrl
    ? `<p class="em-muted" style="margin:18px 0 0;font-size:13px;color:${BRAND.muted};font-family:${FONT}">
        <a href="${esc(secondaryUrl)}" target="_blank" rel="noopener" style="color:${BRAND.indigo};font-weight:600;text-decoration:none">${esc(secondaryLabel)}</a>
      </p>`
    : '';

  const html = `<!doctype html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    body, .em-bg { background: #0b1120 !important; }
    .em-card { background: #121a2b !important; box-shadow: none !important; }
    .em-title { color: #f8fafc !important; }
    .em-text { color: #cbd5e1 !important; }
    .em-muted, .em-footer { color: #94a3b8 !important; }
    .em-brand { color: #f8fafc !important; }
    .em-tagline { color: #94a3b8 !important; }
    .em-divider { background: #1f2937 !important; }
    .em-note { background: #1e293b !important; border-color: #334155 !important; color: #e2e8f0 !important; }
    .em-code { background: #0f172a !important; border-color: #334155 !important; }
    .em-code span { color: #f8fafc !important; }
    .em-badge { background: #1e1b4b !important; color: #c7d2fe !important; }
    .em-footer-link, .em-footer-link a { color: #94a3b8 !important; }
  }
</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:${BRAND.bg};font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${esc(preheader || title)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-bg" style="background:${BRAND.bg};width:100%">
  <tr>
    <td align="center" style="padding:28px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-card" style="max-width:560px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.10)">

        <tr>
          <td style="height:6px;background:${BRAND.indigo};background-image:linear-gradient(90deg,${BRAND.indigo},${BRAND.violet});font-size:0;line-height:0">&nbsp;</td>
        </tr>

        <tr>
          <td style="padding:26px 32px 0">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:12px">
                  <a href="${esc(site)}" target="_blank" rel="noopener" style="text-decoration:none">
                    ${mark}
                  </a>
                </td>
                <td>
                  <a href="${esc(site)}" target="_blank" rel="noopener" style="text-decoration:none">
                    <div class="em-brand" style="font-family:${FONT};font-size:17px;font-weight:800;letter-spacing:.06em;color:${BRAND.ink}">CODE QR PRO</div>
                    <div class="em-tagline" style="font-family:${FONT};font-size:11px;letter-spacing:.04em;color:${BRAND.muted};margin-top:2px">МАРКИРОВКА · ЧЕСТНЫЙ ЗНАК · DATAMATRIX</div>
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 32px 34px">
            ${badgeHtml ? `<div style="margin:0 0 12px">${badgeHtml}</div>` : ''}
            <h1 class="em-title" style="margin:0 0 16px;font-family:${FONT};font-size:23px;line-height:1.3;font-weight:800;color:${BRAND.ink}">${esc(title)}</h1>
            ${paragraphs(intro)}
            ${codeBlock}
            ${bodyHtml || ''}
            ${noticeHtml}
            ${button(ctaLabel, ctaUrl)}
            ${secondary}
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px">
            <div class="em-divider" style="height:1px;background:${BRAND.line};font-size:0;line-height:0">&nbsp;</div>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 32px 26px">
            <p class="em-footer" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted}">
              <b class="em-brand" style="color:${BRAND.ink}">CODE QR PRO</b> — генерация GS1 DataMatrix, проверка кодов, наборы с КИН и печать этикеток.
            </p>
            <p class="em-footer" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted}">
              Сайт: <a href="${esc(site)}" target="_blank" rel="noopener" style="color:${BRAND.indigo};text-decoration:none">${esc(site.replace(/^https?:\/\//, ''))}</a>
              &nbsp;·&nbsp; Поддержка: <a href="mailto:${esc(support)}" style="color:${BRAND.indigo};text-decoration:none">${esc(support)}</a>
            </p>
            ${footerNote ? `<p class="em-footer" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted}">${esc(footerNote).replace(/\r?\n/g, '<br>')}</p>` : ''}
            ${unsubscribeUrl
              ? `<p class="em-footer-link" style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:#94a3b8"><a href="${esc(unsubscribeUrl)}" target="_blank" rel="noopener" style="color:#94a3b8;text-decoration:underline">Отписаться от рассылки</a></p>`
              : '<p class="em-footer-link" style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:#94a3b8">Это сервисное письмо о вашем аккаунте — отвечать на него не нужно.</p>'}
          </td>
        </tr>
      </table>

      <div class="em-footer" style="max-width:560px;margin:14px auto 0;font-family:${FONT};font-size:11px;line-height:1.5;color:#94a3b8;text-align:center">
        Если письмо попало не к вам — просто удалите его.
      </div>
    </td>
  </tr>
</table>
</body></html>`;

  const plainParts = [
    `CODE QR PRO — ${site.replace(/^https?:\/\//, '')}`,
    '',
    title,
    '',
    String(intro || '').trim(),
    code ? `\nКод: ${code}` : '',
    notice ? `\n${notice}` : '',
    ctaLabel && ctaUrl ? `\n${ctaLabel}: ${ctaUrl}` : '',
    secondaryLabel && secondaryUrl ? `\n${secondaryLabel}: ${secondaryUrl}` : '',
    '',
    '---',
    'CODE QR PRO · GS1 DataMatrix и маркировка «Честный ЗНАК»',
    `Поддержка: ${support}`,
    footerNote || '',
    unsubscribeUrl ? `Отписаться: ${unsubscribeUrl}` : ''
  ].filter((part) => part !== '');

  return { html, text: plainParts.join('\n') };
}
