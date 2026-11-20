import { renderBarcode, renderBarcodeMany } from './lib/barcode-pool.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRawGs1, gs1BarcodeText } from './gs1.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LABEL_FONT = join(__dirname, '..', 'assets', 'LiberationSans-Regular.ttf');

// Сколько этикеток готовим за один проход: кодирование штрихкодов параллелится
// по воркерам, а память остаётся ограниченной (большие пакеты не копят мегабайты).
const RESOLVE_CHUNK = Math.max(10, Number(process.env.LABELS_CHUNK || 48));

function eanCheckDigit(base) {
  let sum = 0;
  let weight = 3;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

// Описание элемента шаблона для строки данных: либо штрихкод (opts для bwip-js),
// либо текст. Вынесено отдельно, чтобы одинаково готовить и одну этикетку, и пакет.
function elementPlan(el, data) {
  const base = { id: el.id, type: el.type, x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.fontSize || 10, align: el.align || 'left' };
  if (el.type === 'datamatrix') {
    const source = String(data.code || el.text || '');
    if (!source) return { base, text: '' };
    const isGs1 = /^\(\d{2,4}\)/.test(source) || /^01\d{14}/.test(source);
    const opts = isGs1
      ? { bcid: 'datamatrix', text: gs1BarcodeText(toRawGs1(source)), parsefnc: true, scale: 6, paddingwidth: 0, paddingheight: 0 }
      : { bcid: 'datamatrix', text: source, scale: 6, paddingwidth: 0, paddingheight: 0 };
    return { base, opts };
  }
  if (['code128', 'ean13', 'ean8', 'upca', 'code39', 'itf14', 'gs1_128', 'pdf417', 'qrcode'].includes(el.type)) {
    const content = el.field ? String(data[el.field] ?? '') : (el.text || '');
    if (!content) return { base, text: '' };
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
    return { base, opts };
  }
  const text = el.type === 'field' ? String(data[el.field] ?? '') : String(el.text ?? '');
  return { base, text };
}

// PNG держим буфером: PDFKit вставляет буфер напрямую, а base64 нужен только
// для JSON-ответа/HTML-печати. Раньше на каждую этикетку тратилась лишняя
// пара «PNG → base64 → PNG», на пакете из 1000 кодов это заметно.
function planToElement(plan, png) {
  if (plan.opts) return { ...plan.base, pngBuffer: Buffer.isBuffer(png) ? png : Buffer.from(png) };
  return { ...plan.base, text: plan.text };
}

// Разрешает элементы шаблона в конкретные данные строки (тексты + PNG штрихкодов)
export async function resolveElements(template, data) {
  const plans = (template.elements || []).map((el) => elementPlan(el, data));
  const out = [];
  for (const plan of plans) {
    if (!plan.opts) {
      out.push(planToElement(plan, null));
      continue;
    }
    const png = await renderBarcode(plan.opts, 'png');
    out.push(planToElement(plan, png));
  }
  return out;
}

// То же для пакета строк: все штрихкоды пакета кодируются ОДНИМ заходом через
// пул воркеров (параллельно по ядрам), поэтому пакет этикеток готовится в
// несколько раз быстрее и не блокирует сервер на всё время генерации.
export async function resolveElementsMany(template, dataRows) {
  const perRow = dataRows.map((data) => (template.elements || []).map((el) => elementPlan(el, data)));
  const tasks = [];
  for (const plans of perRow) {
    for (const plan of plans) {
      if (plan.opts) tasks.push({ opts: plan.opts, kind: 'png' });
    }
  }
  const rendered = tasks.length ? await renderBarcodeMany(tasks) : [];
  let index = 0;
  return perRow.map((plans) => plans.map((plan) => (plan.opts ? planToElement(plan, rendered[index++]) : planToElement(plan, null))));
}

const K = 72 / 25.4; // мм → пункты PDF

// Рисует лист А4 с сеткой этикеток или PDF по одной этикетке на страницу
export async function renderLabelsPdf(doc, template, dataRows, options = {}) {
  // Встроенный шрифт с кириллицей: стандартный Helvetica PDFKit её не поддерживает.
  try { doc.registerFont('LabelFont', LABEL_FONT); doc.font('LabelFont'); } catch { /* fallback */ }
  const pageW = 595.28, pageH = 841.89, margin = 10 * K;
  const lw = template.widthMm * K, lh = template.heightMm * K;

  // Прогресс по этикеткам — для длинных пакетов (клиент видит, сколько готово).
  const total = dataRows.length;
  const report = typeof options.onProgress === 'function' ? options.onProgress : null;

  if (options.single) {
    let i = 0;
    for (let start = 0; start < dataRows.length; start += RESOLVE_CHUNK) {
      const chunk = dataRows.slice(start, start + RESOLVE_CHUNK);
      const resolved = await resolveElementsMany(template, chunk);
      for (const els of resolved) {
        if (i > 0) doc.addPage({ size: [lw, lh], margin: 0 });
        for (const el of els) {
          const ex = el.x * K, ey = el.y * K, ew = el.w * K, eh = el.h * K;
          if (el.pngBuffer) doc.image(el.pngBuffer, ex, ey, { width: ew, height: eh });
          else if (el.text) doc.fontSize(el.fontSize).fillColor('#000000').text(el.text, ex, ey, { width: ew, height: eh, align: el.align });
        }
        i++;
        if (report) report(i, total);
      }
    }
    return;
  }

  const cols = Math.max(1, Math.floor((pageW - 2 * margin) / lw));
  const rows = Math.max(1, Math.floor((pageH - 2 * margin) / lh));
  let i = 0;
  for (let start = 0; start < dataRows.length; start += RESOLVE_CHUNK) {
    const chunk = dataRows.slice(start, start + RESOLVE_CHUNK);
    const resolved = await resolveElementsMany(template, chunk);
    for (const els of resolved) {
      const pos = i % (cols * rows);
      if (pos === 0 && i > 0) doc.addPage();
      const cx = margin + (pos % cols) * lw;
      const cy = margin + Math.floor(pos / cols) * lh;
      doc.save().rect(cx, cy, lw, lh).lineWidth(0.4).strokeColor('#cccccc').stroke().restore();
      for (const el of els) {
        const ex = cx + el.x * K, ey = cy + el.y * K, ew = el.w * K, eh = el.h * K;
        if (el.pngBuffer) doc.image(el.pngBuffer, ex, ey, { width: ew, height: eh });
        else if (el.text) doc.fontSize(el.fontSize).fillColor('#000000').text(el.text, ex, ey, { width: ew, height: eh, align: el.align });
      }
      i++;
      if (report) report(i, total);
    }
  }
  if (i === 0) doc.fontSize(12).fillColor('#333333').text('Нет сформированных строк', margin, margin);
}
