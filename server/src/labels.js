import bwipjs from 'bwip-js';
import { toRawGs1, gs1BarcodeText } from './gs1.js';

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
    if (['code128', 'ean13', 'qrcode'].includes(el.type)) {
      const content = el.field ? String(data[el.field] ?? '') : (el.text || '');
      if (!content) { out.push({ ...base, text: '' }); continue; }
      const opts = { bcid: el.type, text: content, scale: 6, includetext: false };
      if (el.type === 'code128') opts.height = 12;
      else if (el.type === 'ean13') { opts.height = 12; opts.includetext = true; opts.textxalign = 'center'; }
      else if (el.type === 'qrcode') opts.scale = 4;
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

