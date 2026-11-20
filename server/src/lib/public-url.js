import { getSetting } from '../settings.js';

export const publicUrl = () => String(
  getSetting('public_url', process.env.PUBLIC_URL || 'https://code-qr.stockcity.ru') || 'https://code-qr.stockcity.ru'
).replace(/\/+$/, '');

export const supportEmail = () => getSetting('support_email', 'code-qr-pro@mail.ru') || 'code-qr-pro@mail.ru';
