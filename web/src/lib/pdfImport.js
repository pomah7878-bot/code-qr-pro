import { extractKizCodes } from './pdfCodes.js';

// Распознавание DataMatrix со страниц PDF идёт в отдельном worker'е (ZXing WASM).
// Раньше декодирование выполнялось в главном потоке и на многостраничном PDF
// интерфейс «замирал» на всё время разбора — страница не отвечала на нажатия.
let decodeWorker = null;
let decodeSeq = 0;
const waiting = new Map();

function getPageWorker() {
  if (typeof Worker === 'undefined') return null;
  if (decodeWorker) return decodeWorker;
  try {
    const worker = new Worker(new URL('./zxing-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const waiter = waiting.get(data?.id);
      if (!waiter) return;
      waiting.delete(data.id);
      if (data.error) waiter.reject(new Error(data.error));
      else waiter.resolve(data.texts || []);
    };
    worker.onerror = () => {
      for (const waiter of waiting.values()) waiter.reject(new Error('Декодер остановился'));
      waiting.clear();
      decodeWorker = null;
    };
    decodeWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

function decodeImageInWorker(imageData) {
  const worker = getPageWorker();
  if (!worker) return Promise.reject(new Error('Worker недоступен'));
  return new Promise((resolve, reject) => {
    const id = ++decodeSeq;
    waiting.set(id, { resolve, reject });
    const pixels = new Uint8ClampedArray(imageData.data);
    worker.postMessage(
      { type: 'decodePage', id, buffer: pixels.buffer, width: imageData.width, height: imageData.height },
      [pixels.buffer]
    );
  });
}

// Резервный путь: если worker по какой-то причине не поднялся, распознаём
// в главном потоке, как это было раньше (медленнее, но результат не теряется).
let fallbackZxing = null;
let fallbackReader = null;
let fallbackHints = null;

async function fallbackDecodeImage(imageData) {
  if (!fallbackZxing) {
    fallbackZxing = await import('@zxing/library');
    fallbackReader = new fallbackZxing.DataMatrixReader();
    fallbackHints = new Map([[fallbackZxing.DecodeHintType.TRY_HARDER, true]]);
  }
  const { width, height } = imageData;
  const luma = new Uint8ClampedArray(width * height);
  const data = imageData.data;
  for (let i = 0; i < luma.length; i++) {
    luma[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
  }
  try {
    const source = new fallbackZxing.RGBLuminanceSource(luma, width, height);
    const bitmap = new fallbackZxing.BinaryBitmap(new fallbackZxing.HybridBinarizer(source));
    return [fallbackReader.decode(bitmap, fallbackHints).getText()];
  } catch {
    return [];
  }
}

// Читает PDF: сначала текстовый слой, если кодов нет — распознаёт DataMatrix со страниц.
export async function importPdf(file, onProgress = () => {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false
  }).promise;

  try {
    // 1. Текстовый слой — быстро и точно, если коды в PDF текстом
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (typeof item.str === 'string') text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      page.cleanup();
      if (i % 10 === 0) onProgress({ phase: 'text', page: i, total: pdf.numPages, found: 0 });
    }
    const textCodes = extractKizCodes(text);
    if (textCodes.length) {
      return { codes: textCodes, method: 'text', pages: pdf.numPages, failed: 0 };
    }

    // 2. DataMatrix: рендерим страницы и декодируем штрихкод в worker'е
    const found = new Set();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let failed = 0;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const texts = await decodePage(page, canvas, ctx);
        const codes = [];
        for (const payload of texts) {
          const pageCodes = extractKizCodes(payload);
          if (pageCodes.length) codes.push(...pageCodes);
        }
        if (codes.length) codes.forEach((c) => found.add(c));
        else failed += 1;
      } catch {
        failed += 1;
      }
      page.cleanup();
      if (i % 5 === 0 || i === pdf.numPages) {
        onProgress({ phase: 'barcode', page: i, total: pdf.numPages, found: found.size });
      }
    }

    return { codes: [...found], method: 'barcode', pages: pdf.numPages, failed };
  } finally {
    await pdf.destroy();
  }
}

async function decodePage(page, canvas, ctx) {
  const base = page.getViewport({ scale: 1 });
  // мелкие этикетки рендерим крупнее, A4 — без гигантских полотен
  const scale = Math.min(4, Math.max(1, 900 / base.width));

  for (const s of [scale, scale * 1.8]) {
    const viewport = page.getViewport({ scale: s });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let texts = null;
    try {
      texts = await decodeImageInWorker(image);
    } catch {
      // worker не поднялся — этот же кадр разбираем в главном потоке
      texts = await fallbackDecodeImage(image);
    }
    if (texts && texts.length) return texts;
  }
  return [];
}
