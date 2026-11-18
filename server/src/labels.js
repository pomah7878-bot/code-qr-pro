import bwipjs from 'bwip-js';

// «Сырой» код с GS → скобочная запись для bwip-js gs1datamatrix.
// Серийник может содержать скобки — они остаются частью значения.
function toGs1Paren(raw) {
  const s = String(raw || '');
  if (/^\(\d{2,4}\)/.test(s)) return s;
  const m = s.match(/^01(\d{14})21([^\x1d]*)(?:\x1d91([^\x1d]*))?(?:\x1d92([\s\S]*))?$/);
  if (!m) return s;
  return `(01)${m[1]}(21)${m[2]}${m[3] ? `(91)${m[3]}` : ''}${m[4] ? `(92)${m[4]}` : ''}`;
}

// Разрешает элементы шаблона в конкретные данные строки (тексты + PNG штрихкодов)
export async function resolveElements(template, data) {
  const out = [];
  for (const el of template.elements || []) {
    const base = { id: el.id, type: el.type, x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.fontSize || 10, align: el.align || 'left' };
    if (el.type === 'datamatrix' || el.type === 'code128') {
      const source = el.type === 'datamatrix'
        ? (data.code || el.text || '')
        : (el.field ? String(data[el.field] ?? '') : (el.text || ''));
      const content = el.type === 'datamatrix' ? toGs1Paren(source) : source;
      if (!content) { out.push({ ...base, text: '' }); continue; }
      const bcid = el.type === 'code128' ? 'code128' : (/^\(\d{2,4}\)/.test(content) ? 'gs1datamatrix' : 'datamatrix');
      const opts = { bcid, text: content, scale: 6, includetext: false };
      if (bcid === 'code128') opts.height = 12;
      else { opts.paddingwidth = 4; opts.paddingheight = 4; }
      const png = await bwipjs.toBuffer(opts);
      out.push({ ...base, pngBase64: png.toString('base64') });
    } else {
      const text = el.type === 'field' ? String(data[el.field] ?? '') : String(el.text ?? '');
      out.push({ ...base, text });
    }
  }
  return out;
}

const K = 72 / 25.4; // мм → пункты PDF

// Рисует лист А4 с сеткой этикеток в pdfkit-документ
export async function renderLabelsPdf(doc, template, dataRows) {
  const pageW = 595.28, pageH = 841.89, margin = 10 * K;
  const lw = template.widthMm * K, lh = template.heightMm * K;
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

