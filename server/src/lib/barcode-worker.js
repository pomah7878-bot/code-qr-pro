// Рендер штрихкодов в отдельном потоке: bwip-js считает синхронно, поэтому
// висеть он должен не в основном потоке сервера (иначе на время генерации
// этикеток замирают все остальные запросы).
import { parentPort } from 'node:worker_threads';
import bwipjs from 'bwip-js';

parentPort.on('message', async (message) => {
  const { id, kind, opts } = message || {};
  try {
    const out = kind === 'svg' ? await bwipjs.toSVG(opts) : await bwipjs.toBuffer(opts);
    parentPort.postMessage({ id, ok: true, data: kind === 'svg' ? String(out) : out });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e?.message || e) });
  }
});
