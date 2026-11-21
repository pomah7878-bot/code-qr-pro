import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { getSetting } from '../settings.js';

const FONT = join(import.meta.dirname, '..', '..', 'assets', 'LiberationSans-Regular.ttf');

/** Реквизиты продавца для счетов (заполняются в админке → Настройки). */
export function invoiceSeller() {
  const seller = {
    name: getSetting('invoice_name', ''),
    status: getSetting('invoice_status', 'Плательщик налога на профессиональный доход (самозанятый)'),
    inn: getSetting('invoice_inn', '504706547269'),
    address: getSetting('invoice_address', ''),
    bank: getSetting('invoice_bank', ''),
    bik: getSetting('invoice_bik', ''),
    account: getSetting('invoice_account', ''),
    corr: getSetting('invoice_corr', ''),
    phone: getSetting('invoice_phone', ''),
    email: getSetting('invoice_email', 'code-qr-pro@mail.ru')
  };
  const missing = [];
  if (!seller.name.trim()) missing.push('наименование продавца');
  if (!seller.bank.trim()) missing.push('банк');
  if (!/^\d{9}$/.test(seller.bik.replace(/\D/g, ''))) missing.push('БИК (9 цифр)');
  if (!/^\d{20}$/.test(seller.account.replace(/\D/g, ''))) missing.push('расчётный счёт (20 цифр)');
  if (!/^\d{20}$/.test(seller.corr.replace(/\D/g, ''))) missing.push('корр. счёт (20 цифр)');
  return { ...seller, ready: missing.length === 0, missing };
}

export function validateBuyer(input = {}) {
  const companyName = String(input.companyName || '').trim();
  const inn = String(input.companyInn || '').replace(/\D/g, '');
  const kpp = String(input.companyKpp || '').replace(/\D/g, '');
  const address = String(input.companyAddress || '').trim();
  const email = String(input.companyEmail || '').trim();
  const errors = [];
  if (companyName.length < 2 || companyName.length > 250) errors.push('Укажите полное наименование организации');
  if (!/^\d{10}$|^\d{12}$/.test(inn)) errors.push('ИНН организации — 10 или 12 цифр');
  if (inn.length === 10 && !/^\d{9}$/.test(kpp)) errors.push('КПП организации — 9 цифр');
  if (kpp && !/^\d{9}$/.test(kpp)) errors.push('КПП должен содержать 9 цифр');
  if (address.length < 5 || address.length > 400) errors.push('Укажите юридический адрес организации');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Некорректный email для счёта');
  return {
    ok: errors.length === 0,
    error: errors[0] || '',
    errors,
    buyer: {
      companyName: companyName.slice(0, 250),
      companyInn: inn,
      companyKpp: kpp,
      companyAddress: address.slice(0, 400),
      companyEmail: email.slice(0, 200)
    }
  };
}

export function invoiceNumberFor(order) {
  return String(order.invoice_number || '').trim() || `СЧ-${order.id}`;
}

function money(value) {
  return Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value) {
  const raw = String(value || '').replace(' ', 'T');
  const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Счёт на оплату по заказу. Возвращает Buffer PDF. */
export function generateInvoicePdf(order) {
  const seller = invoiceSeller();
  const number = invoiceNumberFor(order);
  const date = fmtDate(order.invoice_issued_at || order.created_at || new Date().toISOString());
  const title = String(order.plan_title || order.plan || 'Подписка CODE QR PRO').slice(0, 200);
  const days = Number(order.days) || 30;
  const amount = Number(order.amount) || 0;
  const rub = money(amount);
  const rubWords = ''; // сумма прописью не выводим — для самозанятого достаточно цифр

  const doc = new PDFDocument({ size: 'A4', margin: 42, autoFirstPage: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  try { doc.registerFont('InvoiceFont', FONT); doc.font('InvoiceFont'); } catch (e) { console.error('invoice font:', e.message); }
  const font = 'InvoiceFont';
  doc.font(font);

  doc.fontSize(16).text('СЧЁТ НА ОПЛАТУ', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).text(`№ ${number} от ${date}`, { align: 'center' });
  doc.moveDown(0.8);

  // Платёжные реквизиты
  doc.fontSize(9).text('Получатель платежа:', { underline: true });
  doc.fontSize(10);
  doc.text(seller.name || 'Владелец сервиса CODE QR PRO');
  if (seller.status) doc.text(seller.status);
  doc.text(`ИНН ${seller.inn}`);
  if (seller.address) doc.text(`Адрес: ${seller.address}`);
  if (seller.phone) doc.text(`Телефон: ${seller.phone}`);
  if (seller.email) doc.text(`Email: ${seller.email}`);
  if (seller.ready) {
    doc.moveDown(0.4);
    doc.text(`Банк: ${seller.bank}`);
    doc.text(`БИК: ${seller.bik}`);
    doc.text(`Расчётный счёт: ${seller.account}`);
    doc.text(`Корреспондентский счёт: ${seller.corr}`);
  } else {
    doc.moveDown(0.4);
    doc.fillColor('#b91c1c').text('Внимание: банковские реквизиты продавца не заполнены в настройках сервиса.');
    doc.fillColor('#000000');
  }

  doc.moveDown(0.8);
  doc.fontSize(9).text('Покупатель:', { underline: true });
  doc.fontSize(10);
  doc.text(order.company_name || '—');
  doc.text(`ИНН ${order.company_inn || '—'}${order.company_kpp ? ' / КПП ' + order.company_kpp : ''}`);
  if (order.company_address) doc.text(`Адрес: ${order.company_address}`);
  if (order.company_email) doc.text(`Email: ${order.company_email}`);
  const accountEmail = order.buyer_email || '';
  if (accountEmail && accountEmail !== order.company_email) doc.text(`Аккаунт: ${accountEmail}`);
  doc.moveDown(0.8);

  // Таблица
  const left = 42;
  const right = 553;
  const top = doc.y;
  doc.fontSize(9);
  doc.text('№', left, top, { width: 24 });
  doc.text('Наименование услуги', left + 26, top, { width: 280 });
  doc.text('Кол-во', left + 310, top, { width: 55, align: 'right' });
  doc.text('Сумма, руб.', left + 360, top, { width: 110, align: 'right' });
  doc.moveTo(left, top + 14).lineTo(right, top + 14).stroke();
  const rowY = top + 20;
  doc.text('1', left, rowY, { width: 24 });
  doc.text(`${title}, доступ на ${days} дн.`, left + 26, rowY, { width: 280 });
  doc.text('1', left + 310, rowY, { width: 55, align: 'right' });
  doc.text(rub, left + 370, rowY, { width: 100, align: 'right' });
  doc.moveTo(left, rowY + 32).lineTo(right, rowY + 32).stroke();
  doc.text('Итого к оплате:', left + 200, rowY + 40, { width: 140, align: 'right' });
  doc.fontSize(11).text(`${rub} руб.`, left + 340, rowY + 38, { width: 130, align: 'right' });
  doc.fontSize(9).text('Без НДС (плательщик налога на профессиональный доход)', left, rowY + 58, { width: right - left });
  doc.moveDown(0.6);

  doc.text(`Назначение платежа: оплата по счёту № ${number} от ${date} — ${title}, ${days} дн.`, left, rowY + 78, { width: right - left });
  doc.moveDown(0.6);
  doc.fontSize(9).text('Счёт сформирован автоматически. Оплата по счёту производится банковским переводом. Доступ активируется после подтверждения поступления оплаты.', left, rowY + 100, { width: right - left });

  // Подпись
  const signY = Math.max(doc.y + 46, rowY + 150);
  doc.fontSize(9).text('Поставщик:', left, signY);
  doc.moveTo(left + 60, signY + 22).lineTo(left + 230, signY + 22).stroke();
  doc.text(seller.name || '', left + 60, signY + 4, { width: 170 });
  doc.text('(подпись)', left + 110, signY + 24, { width: 100, align: 'center' });

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
