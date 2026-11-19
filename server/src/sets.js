import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRawGs1, gs1BarcodeText } from './gs1.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LABEL_FONT = join(__dirname, '..', 'assets', 'LiberationSans-Regular.ttf');
const MM = 72 / 25.4;
const FORMATS = {
  '58x40': [58, 40],
  '58x80': [58, 80],
  '40x58': [40, 58],
  '43x25': [43, 25]
};

export function normalizeSetPayload(body = {}) {
  const template = body.template || {};
  const format = FORMATS[template.format] ? template.format : '58x80';
  const components = Array.isArray(template.components) ? template.components : [];
  const setCodes = (Array.isArray(body.setCodes) ? body.setCodes : []).map((c) => String(c || '').trim()).filter(Boolean);
  const componentCodes = (Array.isArray(body.componentCodes) ? body.componentCodes : []).map((c) => ({
    gtin: String(c?.gtin || '').trim(),
    name: String(c?.name || '').trim(),
    qty: Math.max(1, Math.min(50, Number(c?.qty) || 1)),
    codes: (Array.isArray(c?.codes) ? c.codes : []).map((x) => String(x || '').trim()).filter(Boolean)
  }));
  return {
    name: String(template.name || 'Набор').slice(0, 120),
    setGtin: (() => { const d = String(template.setGtin || '').replace(/\D/g, ''); return d ? d.padStart(14, '0').slice(-14) : ''; })(),
    format,
    showComposition: template.showComposition !== false,
    onlySet: template.onlySet === true,
    components: components.map((c) => ({
      gtin: (() => { const d = String(c?.gtin || '').replace(/\D/g, ''); return d ? d.padStart(14, '0').slice(-14) : ''; })(),
      name: String(c?.name || '').slice(0, 120),
      qty: Math.max(1, Math.min(50, Number(c?.qty) || 1))
    })),
    setCodes,
    componentCodes
  };
}

export function validateSetPayload(p) {
  if (!p.setGtin || !/^\d{14}$/.test(p.setGtin)) return 'Укажите GTIN набора (14 цифр)';
  if (!p.name) return 'Укажите название набора';
  if (!p.components.length) return 'Добавьте хотя бы один товар в состав набора';
  if (p.components.length > 20) return 'В наборе может быть не больше 20 позиций';
  for (const c of p.components) {
    if (!c.gtin || !/^\d{14}$/.test(c.gtin)) return `GTIN товара «${c.name || 'без названия'}» должен быть 14 цифр`;
    if (!c.name) return 'У каждого товара должно быть название';
  }
  if (!p.setCodes.length) return 'Вставьте КИЗ набора — по одному на строку';
  if (p.setCodes.length > 100) return 'За раз можно до 100 наборов';
  if (!p.onlySet) {
    if (p.componentCodes.length !== p.components.length) return 'Не совпало количество позиций состава';
    for (let i = 0; i < p.components.length; i++) {
      const need = p.setCodes.length * p.components[i].qty;
      if (p.componentCodes[i].codes.length < need) {
        return `Для «${p.components[i].name}» нужно ${need} кодов, вставлено ${p.componentCodes[i].codes.length}`;
      }
    }
  }
  const pages = p.setCodes.length * (1 + (p.onlySet ? 0 : p.components.reduce((s, c) => s + c.qty, 0)));
  if (pages > 1000) return 'Слишком много этикеток за раз — уменьшите количество наборов';
  return '';
}

async function dataMatrixPng(code) {
  const raw = toRawGs1(code || '');
  const text = gs1BarcodeText(raw);
  return bwipjs.toBuffer({
    bcid: 'datamatrix',
    text,
    parsefnc: true,
    scale: 6,
    paddingwidth: 12,
    paddingheight: 12,
    includetext: false
  });
}

function fitText(doc, text, x, y, width, height, size = 8) {
  doc.font('LabelFont').fontSize(size).fillColor('#000000').text(String(text || ''), x, y, {
    width,
    height: Math.max(3, height),
    ellipsis: true
  });
}

function ellipseText(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export async function renderSetsPdf(payload) {
  const p = payload?.template ? normalizeSetPayload(payload) : payload;
  const error = validateSetPayload(p);
  if (error) { const e = new Error(error); e.statusCode = 400; throw e; }
  const [wMm, hMm] = FORMATS[p.format];
  const W = wMm * MM, H = hMm * MM, m = 2 * MM;

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  doc.registerFont('LabelFont', LABEL_FONT);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  for (let s = 0; s < p.setCodes.length; s++) {
    const setCode = p.setCodes[s];
    const png = await dataMatrixPng(setCode);
    doc.addPage({ size: [W, H], margin: 0 });
    const qrSize = Math.min(W - m * 2, H * 0.52);
    doc.image(png, (W - qrSize) / 2, m, { width: qrSize, height: qrSize });
    const textY = m + qrSize + 1.5 * MM;
    fitText(doc, p.name, m, textY, W - m * 2, 7 * MM, 8);
    if (p.showComposition) {
      const list = p.components.map((c) => `${c.name} ×${c.qty}`).join(', ');
      fitText(doc, `Состав: ${list}`, m, textY + 7 * MM, W - m * 2, Math.max(5 * MM, H - textY - 9 * MM), 5.5);
    }
    fitText(doc, `КИЗ набора: ${ellipseText(setCode, 44)}`, m, H - m - 3.5 * MM, W - m * 2, 4 * MM, 4.5);

    if (!p.onlySet) {
      for (let c = 0; c < p.components.length; c++) {
        const comp = p.components[c];
        const codes = p.componentCodes[c]?.codes || [];
        const start = s * comp.qty;
        for (let q = 0; q < comp.qty; q++) {
          const code = codes[start + q];
          if (!code) continue;
          const cpng = await dataMatrixPng(code);
          doc.addPage({ size: [W, H], margin: 0 });
          const cs = Math.min(W - m * 2, H * 0.55);
          doc.image(cpng, (W - cs) / 2, m, { width: cs, height: cs });
          fitText(doc, comp.name, m, m + cs + 2 * MM, W - m * 2, 7 * MM, 8);
          fitText(doc, `GTIN: ${comp.gtin}`, m, m + cs + 9 * MM, W - m * 2, 4 * MM, 5.5);
          fitText(doc, `Набор: ${p.name}`, m, H - m - 3.5 * MM, W - m * 2, 4 * MM, 4.5);
        }
      }
    }
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
