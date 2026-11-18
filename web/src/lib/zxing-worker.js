import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

const options = {
  formats: ['DataMatrix'],
  textMode: 'Plain',
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 3
};

let readyPromise = null;
let nextFallbackAt = 0;

function prepare() {
  if (!readyPromise) readyPromise = prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
  return readyPromise;
}

function cropCenter(image, scale) {
  const width = Math.max(1, Math.floor(image.width * scale));
  const height = Math.max(1, Math.floor(image.height * scale));
  const x = Math.floor((image.width - width) / 2);
  const y = Math.floor((image.height - height) / 2);
  const out = new ImageData(width, height);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(start, start + width * 4), row * width * 4);
  }
  return out;
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'decode') return;
  try {
    await prepare();
    const image = new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height);
    let results = await readBarcodes(image, options);
    if (!results.some((r) => r.isValid) && performance.now() >= nextFallbackAt) {
      for (const scale of [0.75, 0.5]) {
        const cropped = await readBarcodes(cropCenter(image, scale), options);
        if (cropped.some((r) => r.isValid)) { results = cropped; break; }
      }
      nextFallbackAt = performance.now() + 750;
    }
    self.postMessage({
      id: data.id,
      results: results.filter((r) => r.isValid).map((r) => ({
        text: r.text,
        format: r.format,
        position: r.position || null
      }))
    });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message || String(e), results: [] });
  }
};
