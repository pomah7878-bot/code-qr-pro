import { writeFileSync } from 'node:fs';
import { renderBrandEmail } from '../src/lib/email-template.js';

const out = process.argv[2] || 'email-preview.html';
const { html, text } = renderBrandEmail({
  title: 'Восстановление пароля',
  badge: 'Код доступа',
  preheader: 'Код для смены пароля: 481516',
  intro: 'Здравствуйте!\n\nВы запросили восстановление пароля в CODE QR PRO. Введите код на странице восстановления:',
  code: '481516',
  notice: 'Код действует 15 минут. Если вы не запрашивали восстановление — просто проигнорируйте письмо.',
  noticeTone: 'warn',
  ctaLabel: 'Ввести код',
  ctaUrl: 'https://code-qr.stockcity.ru/login?reset=1'
});
writeFileSync(out, html, 'utf8');
writeFileSync(out.replace(/\.html$/, '.txt'), text, 'utf8');
console.log(JSON.stringify({ htmlBytes: Buffer.byteLength(html), textBytes: Buffer.byteLength(text), out }));
