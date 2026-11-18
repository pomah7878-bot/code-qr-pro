import { extractKizCodes } from './pdfCodes.js';

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

    // 2. DataMatrix: рендерим страницы и декодируем штрихкод
    const zxing = await import('@zxing/library');
    const reader = new zxing.DataMatrixReader();
    const hints = new Map([[zxing.DecodeHintType.TRY_HARDER, true]]);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const found = new Set();
    let failed = 0;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const payload = await decodePage(page, zxing, reader, hints, canvas, ctx);
        const codes = payload ? extractKizCodes(payload) : [];
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

async function decodePage(page, zxing, reader, hints, canvas, ctx) {
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

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const luma = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0; i < luma.length; i++) {
      luma[i] = (img.data[i * 4] * 0.299 + img.data[i * 4 + 1] * 0.587 + img.data[i * 4 + 2] * 0.114) | 0;
    }
    try {
      const source = new zxing.RGBLuminanceSource(luma, canvas.width, canvas.height);
      const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(source));
      return reader.decode(bitmap, hints).getText();
    } catch {
      /* пробуем крупнее */
    }
  }
  return null;
}
