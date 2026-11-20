// Пул воркеров для рендера штрихкодов (bwip-js).
//
// Зачем: bwip-js кодирует штрихкод синхронно, ~6-7 мс на DataMatrix. На пакете
// в 1000 кодов это ~7 секунд непрерывной блокировки event loop — в это время
// сервер не отвечает ни на один запрос (страница «висит», другие клиенты ждут).
// Пул выносит кодирование в worker_threads и параллелит его по ядрам.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import bwipjs from 'bwip-js';

const WORKER_URL = new URL('./barcode-worker.js', import.meta.url);
const POOL_SIZE = Math.max(1, Math.min(4, (availableParallelism?.() || 4) - 1));
const MEMO_MAX = 4000;

const memo = new Map(); // одинаковые штрихкоды (повторная печать, PDF + печать) не кодируем заново
let states = null; // [{ worker, task }]
let inlineFallback = false; // воркеры недоступны — считаем в основном потоке (как раньше)
let seq = 0;
const pending = []; // { id, kind, opts }
const waiters = new Map(); // id -> { resolve, reject }

function memoGet(key) {
  const hit = memo.get(key);
  if (!hit) return undefined;
  // поддерживаем порядок «свежие в конце», чтобы вытеснялись самые старые
  memo.delete(key);
  memo.set(key, hit);
  return hit;
}

function memoSet(key, value) {
  if (memo.size >= MEMO_MAX) {
    const oldest = memo.keys().next();
    if (!oldest.done) memo.delete(oldest.value);
  }
  memo.set(key, value);
}

function inlineRender(kind, opts) {
  return Promise.resolve().then(() => (kind === 'svg' ? bwipjs.toSVG(opts) : bwipjs.toBuffer(opts)));
}

function spawn() {
  if (states) return states;
  try {
    states = Array.from({ length: POOL_SIZE }, () => {
      const worker = new Worker(WORKER_URL);
      const state = { worker, task: null };
      worker.on('message', (message) => {
        const waiter = waiters.get(message?.id);
        waiters.delete(message?.id);
        state.task = null;
        try { worker.unref(); } catch { /* ignore */ }
        if (!waiter) return;
        if (message?.ok) waiter.resolve(message.data);
        else waiter.reject(new Error(message?.error || 'barcode render failed'));
        pump();
      });
      worker.on('error', (e) => {
        if (state.task) {
          const waiter = waiters.get(state.task.id);
          waiters.delete(state.task.id);
          state.task = null;
          if (waiter) waiter.reject(e);
        }
        try { worker.terminate(); } catch { /* ignore */ }
        states = (states || []).filter((s) => s !== state);
        pump();
      });
      worker.unref();
      return state;
    });
    return states;
  } catch {
    inlineFallback = true;
    states = [];
    return states;
  }
}

function pump() {
  if (inlineFallback) return;
  const pool = states || spawn();
  if (!pool.length) {
    // воркеры не поднялись — дорабатываем очередь в основном потоке
    inlineFallback = true;
    flushInline();
    return;
  }
  for (const state of pool) {
    if (state.task || !pending.length) break;
    const task = pending.shift();
    state.task = task;
    try { state.worker.ref(); } catch { /* ignore */ }
    state.worker.postMessage({ id: task.id, kind: task.kind, opts: task.opts });
  }
  for (const state of pool) {
    if (!state.task) {
      try { state.worker.unref(); } catch { /* ignore */ }
    }
  }
}

function flushInline() {
  while (pending.length) {
    const task = pending.shift();
    const waiter = waiters.get(task.id);
    waiters.delete(task.id);
    if (!waiter) continue;
    inlineRender(task.kind, task.opts).then(waiter.resolve, waiter.reject);
  }
}

/**
 * Рендерит один штрихкод. kind: 'png' (Buffer) или 'svg' (string).
 * opts — те же, что у bwipjs.toBuffer/toSVG.
 */
export function renderBarcode(opts, kind = 'png') {
  const key = `${kind}:${JSON.stringify(opts)}`;
  const cached = memoGet(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiters.set(id, { resolve, reject });
    pending.push({ id, kind, opts });
    if (!states && !inlineFallback) spawn();
    pump();
  }).then((data) => {
    // Из worker'а Buffer приходит как Uint8Array (structured clone) — возвращаем
    // настоящий Buffer: его ждут PDFKit и вызовы .toString('base64').
    const value = kind === 'svg' ? String(data) : (Buffer.isBuffer(data) ? data : Buffer.from(data));
    memoSet(key, value);
    return value;
  });
}

/**
 * Рендерит набор штрихкодов (порядок сохраняется). Параллелится по пулу.
 * tasks: [{ opts, kind? }]
 */
export function renderBarcodeMany(tasks) {
  return Promise.all(tasks.map((task) => renderBarcode(task.opts, task.kind || 'png')));
}

export function barcodePoolSize() {
  return POOL_SIZE;
}

export function barcodePoolStats() {
  return {
    size: POOL_SIZE,
    memo: memo.size,
    inlineFallback,
    busy: (states || []).filter((s) => s.task).length,
    pending: pending.length
  };
}

export function closeBarcodePool() {
  for (const state of states || []) {
    try { state.worker.terminate(); } catch { /* ignore */ }
  }
  states = null;
  waiters.clear();
  pending.length = 0;
}
