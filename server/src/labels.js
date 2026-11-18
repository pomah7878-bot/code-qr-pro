import bwipjs from 'bwip-js';
import { toRawGs1, gs1BarcodeText } from './gs1.js';

function eanCheckDigit(base) {
  let sum = 0;
  let weight = 3;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

// Разрешает элементы шаблона в конкретные данные строки (тексты + PNG штрихкодов)
export async function resolveElements(template, data) {
  const out = [];
  for (const el of template.elements || []) {
    const base = { id: el.id, type: el.type, x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.fontSize || 10, align: el.align || 'left' };
    if (el.type === 'datamatrix') {
      const source = String(data.code || el.text || '');
      if (!source) { out.push({ ...base, text: '' }); continue; }
      const isGs1 = /^\(\d{2,4}\)/.test(source) || /^01\d{14}/.test(source);
      const opts = isGs1
        ? { bcid: 'datamatrix', text: gs1BarcodeText(toRawGs1(source)), parsefnc: true, scale: 6, paddingwidth: 0, paddingheight: 0 }
        : { bcid: 'datamatrix', text: source, scale: 6, paddingwidth: 0, paddingheight: 0 };
      const png = await bwipjs.toBuffer(opts);
      out.push({ ...base, pngBase64: png.toString('base64') });
      continue;
    }
    if (['code128', 'ean13', 'ean8', 'upca', 'code39', 'itf14', 'gs1_128', 'pdf417', 'qrcode'].includes(el.type)) {
      const content = el.field ? String(data[el.field] ?? '') : (el.text || '');
      if (!content) { out.push({ ...base, text: '' }); continue; }
      let bcid = el.type === 'gs1_128' ? 'gs1-128' : el.type;
      let text = content;
      if (el.type === 'ean13') {
        const compact = content.trim().replace(/\s+/g, '');
        if (/^\d+$/.test(compact)) {
          if (compact.length === 12 || compact.length === 13) {
            const b = compact.slice(0, 12);
            text = b + eanCheckDigit(b);
          } else if (compact.length === 14 && compact.startsWith('0')) {
            const b = compact.slice(1, 13);
            text = b + eanCheckDigit(b);
          } else if (compact.length === 7 || compact.length === 8) {
            const b = compact.slice(0, 7);
            text = b + eanCheckDigit(b);
            bcid = 'ean8';
          } else {
            bcid = 'code128';
            text = compact;
          }
        } else {
          bcid = 'code128';
          text = content;
        }
      } else if (el.type === 'ean8') {
        const compact = content.trim().replace(/\s+/g, '').replace(/\D/g, '');
        if (compact.length === 7 || compact.length === 8) {
          const b = compact.slice(0, 7);
          text = b + eanCheckDigit(b);
        } else {
          bcid = 'code128';
          text = compact || content;
        }
      } else if (el.type === 'upca') {
        const compact = content.trim().replace(/\s+/g, '').replace(/\D/g, '');
        if (compact.length === 11 || compact.length === 12) {
          const b = compact.slice(0, 11);
          text = b + eanCheckDigit(b);
        } else {
          bcid = 'code128';
          text = compact || content;
        }
      } else if (el.type === 'itf14') {
        const compact = content.trim().replace(/\s+/g, '').replace(/\D/g, '');
        if (compact.length === 13 || compact.length === 14) {
          const b = compact.slice(0, 13);
          text = b + eanCheckDigit(b);
        } else {
          bcid = 'code128';
          text = compact || content;
        }
      }
      const opts = { bcid, text, scale: 6, includetext: false };
      if (bcid === 'code128' || bcid === 'code39' || bcid === 'gs1-128') opts.height = 12;
      else if (bcid === 'ean13' || bcid === 'ean8' || bcid === 'upca' || bcid === 'itf14') { opts.height = 12; opts.includetext = true; opts.textxalign = 'center'; }
      else if (bcid === 'qrcode') opts.scale = 4;
      else if (bcid === 'pdf417') opts.scale = 3;
      const png = await bwipjs.toBuffer(opts);
      out.push({ ...base, pngBase64: png.toString('base64') });
      continue;
    }
    const text = el.type === 'field' ? String(data[el.field] ?? '') : String(el.text ?? '');
    out.push({ ...base, text });
  }
  return out;
}

const K = 72 / 25.4; // мм → пункты PDF

// Рисует лист А4 с сеткой этикеток или PDF по одной этикетке на страницу
export async function renderLabelsPdf(doc, template, dataRows, options = {}) {
  const pageW = 595.28, pageH = 841.89, margin = 10 * K;
  const lw = template.widthMm * K, lh = template.heightMm * K;

  if (options.single) {
    let i = 0;
    for (const data of dataRows) {
      if (i > 0) doc.addPage({ size: [lw, lh], margin: 0 });
      const els = await resolveElements(template, data);
      for (const el of els) {
        const ex = el.x * K, ey = el.y * K, ew = el.w * K, eh = el.h * K;
        if (el.pngBase64) doc.image(Buffer.from(el.pngBase64, 'base64'), ex, ey, { width: ew, height: eh });
        else if (el.text) doc.fontSize(el.fontSize).fillColor('#000000').text(el.text, ex, ey, { width: ew, height: eh, align: el.align });
      }
      i++;
    }
    return;
  }

  const cols = Math.max(1, Math.floor((pageW - 2 * margin) / lw));
  const rows = Math.max(1, Math.floor((pageH - 2 * margin) / lh));
  let i = 0;
  for (const data of dataRows) {
    const els = await resolveElements(template, data);
    const pos = i % (cols * rows);
    if (pos === 0 && i > 0) doc.addPage();
    const cx = margin + (pos % cols) * lw;
    const cy = margin + Math.floor(pos / cols) * lh;
    doc.save().rect(cx, cy, lw, lh).lineWidth(0.4).strokeColor('#cccccc').stroke().restore();
    for (const el of els) {
      const ex = cx + el.x * K, ey = cy + el.y * K, ew = el.w * K, eh = el.h * K;
      if (el.pngBase64) doc.image(Buffer.from(el.pngBase64, 'base64'), ex, ey, { width: ew, height: eh });
      else if (el.text) doc.fontSize(el.fontSize).fillColor('#000000').text(el.text, ex, ey, { width: ew, height: eh, align: el.align });
    }
    i++;
  }
  if (i === 0) doc.fontSize(12).fillColor('#333333').text('Нет сформированных строк', margin, margin);
}

