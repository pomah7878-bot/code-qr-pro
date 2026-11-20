// Рендер штрихкодов в отдельном потоке: bwip-js считает синхронно, поэтому
// висеть он должен не в основном потоке сервера (иначе на время генерации
// этикеток замирают все остальные запросы).
import { parentPort } from 'node:worker_threads';
import bwipjs from 'bwip-js';

// DataMatrix в PDF выгоднее рисовать вектором: сырые модули из bwipjs.raw()
// в разы дешевле, чем PNG (нет растеризации и сжатия), а печать получается
// идеально чёткой. Возвращаем строки тёмных модулей: [x, y, widthModule, ...].
function datamatrixRuns(opts) {
  const raw = bwipjs.raw(opts)[0];
  const { pixx, pixy, pixs } = raw;
  const runs = [];
  for (let y = 0; y < pixy; y++) {
    let start = -1;
    for (let x = 0; x <= pixx; x++) {
      const dark = x < pixx && pixs[y * pixx + x] === 1;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        runs.push(start, y, x - start);
        start = -1;
      }
    }
  }
  return { pixx, pixy, runs };
}

parentPort.on('message', async (message) => {
  const { id, kind, opts } = message || {};
  try {
    if (kind === 'dm-vector') {
      parentPort.postMessage({ id, ok: true, data: datamatrixRuns(opts) });
      return;
    }
    const out = kind === 'svg' ? await bwipjs.toSVG(opts) : await bwipjs.toBuffer(opts);
    parentPort.postMessage({ id, ok: true, data: kind === 'svg' ? String(out) : out });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e?.message || e) });
  }
});
