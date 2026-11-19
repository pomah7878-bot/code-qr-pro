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

function gtinCheckDigit(base) {
  let sum = 0, weight = 3;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function validGtin(value) {
  const s = String(value || '');
  if (!/^\d{14}$/.test(s)) return false;
  return gtinCheckDigit(s.slice(0, 13)) === s[13];
}

function codeGtin(code) {
  const s = String(code || '').replace(/^\uFEFF/, '').trim();
  const paren = s.match(/\(01\)(\d{14})/);
  if (paren) return paren[1];
  const raw = s.match(/^01(\d{14})21/);
  return raw ? raw[1] : '';
}

function hasSerial(code) {
  const s = String(code || '').replace(/^\uFEFF/, '').trim();
  return /\(21\)/.test(s) || /^01\d{14}21/.test(s);
}

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
    setGtin: String(template.setGtin || '').replace(/\D/g, ''),
    format,
    showComposition: template.showComposition !== false,
    onlySet: template.onlySet === true,
    components: components.map((c) => ({
      gtin: String(c?.gtin || '').replace(/\D/g, ''),
      name: String(c?.name || '').slice(0, 120),
      qty: Math.max(1, Math.min(50, Number(c?.qty) || 1))
    })),
    setCodes,
    componentCodes
  };
}

export function validateSetPayload(p) {
  if (!validGtin(p.setGtin)) return 'GTIN набора должен быть 14 цифр с правильной контрольной цифрой';
  if (!p.name) return 'Укажите название набора';
  if (!p.components.length) return 'Добавьте хотя бы один товар в состав набора';
  if (p.components.length > 20) return 'В наборе может быть не больше 20 позиций';
  for (const c of p.components) {
    if (!validGtin(c.gtin)) return `GTIN товара «${c.name || 'без названия'}» должен быть 14 цифр с правильной контрольной цифрой`;
    if (!c.name) return 'У каждого товара должно быть название';
  }
  if (!p.setCodes.length) return 'Вставьте КИН набора — по одному на строку';
  if (p.setCodes.length > 100) return 'За раз можно до 100 наборов';
  for (let i = 0; i < p.setCodes.length; i++) {
    const g = codeGtin(p.setCodes[i]);
    if (!g) return `В КИН набора №${i + 1} не найден GTIN (AI 01)`;
    if (!hasSerial(p.setCodes[i])) return `В КИН набора №${i + 1} нет серийного номера (AI 21)`;
    if (g !== p.setGtin) return `КИН набора №${i + 1} относится к GTIN ${g}, а в карточке указан ${p.setGtin}`;
  }
  if (new Set(p.setCodes).size !== p.setCodes.length) return 'КИН набора повторяются — каждый набор должен быть уникальным';
  if (!p.onlySet) {
    if (p.componentCodes.length !== p.components.length) return 'Не совпало количество позиций состава';
    const allComponentCodes = [];
    for (let i = 0; i < p.components.length; i++) {
      const need = p.setCodes.length * p.components[i].qty;
      if (p.componentCodes[i].codes.length < need) {
        return `Для «${p.components[i].name}» нужно ${need} кодов, вставлено ${p.componentCodes[i].codes.length}`;
      }
      for (let j = 0; j < need; j++) {
        const code = p.componentCodes[i].codes[j];
        const g = codeGtin(code);
        if (!g) return `В коде вложения «${p.components[i].name}» №${j + 1} не найден GTIN`;
        if (!hasSerial(code)) return `В коде вложения «${p.components[i].name}» №${j + 1} нет серийного номера (AI 21)`;
        if (g !== p.components[i].gtin) {
          return `Код вложения «${p.components[i].name}» №${j + 1} относится к GTIN ${g}, а не к ${p.components[i].gtin}`;
        }
        allComponentCodes.push(code);
      }
    }
    if (new Set(allComponentCodes).size !== allComponentCodes.length) return 'КИЗ вложений повторяются — каждый код должен быть уникальным';
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
    fitText(doc, `GTIN набора: ${p.setGtin}`, m, textY + 7 * MM, W - m * 2, 4 * MM, 5.5);
    if (p.showComposition) {
      const list = p.components.map((c) => `${c.name} ×${c.qty}`).join(', ');
      fitText(doc, `Состав: ${list}`, m, textY + 11.5 * MM, W - m * 2, Math.max(4 * MM, H - textY - 15 * MM), 5.5);
    }
    fitText(doc, `КИН набора: ${ellipseText(setCode, 44)}`, m, H - m - 3.5 * MM, W - m * 2, 4 * MM, 4.5);

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
        }
      }
    }
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
