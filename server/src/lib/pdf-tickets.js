import crypto from 'node:crypto';

/**
 * Короткоживущие ссылки на готовые PDF.
 *
 * Зачем: iOS Safari не открывает PDF из blob: (пустой экран) и не сохраняет
 * его через атрибут download. Поэтому сервер отдаёт документ по обычному
 * URL — тогда Safari показывает встроенный просмотрщик с «Поделиться».
 *
 * Файлы живут в памяти: TTL 10 минут, максимум 10 штук на пользователя и
 * общий лимит объёма (на боевом сервере ~2 ГБ RAM, бесконечно копить PDF нельзя).
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_PER_USER = 10;
const MAX_BYTES = 60 * 1024 * 1024;
const MAX_TOTAL_BYTES = Math.max(32, Number(process.env.PDF_TICKET_MAX_MB) || 220) * 1024 * 1024;

const items = new Map(); // id -> { userId, buffer, name, at }
let totalBytes = 0;

function drop(id) {
  const item = items.get(id);
  if (!item) return;
  totalBytes -= item.buffer.length;
  items.delete(id);
}

function prune() {
  const now = Date.now();
  for (const [id, item] of items) {
    if (now - item.at > TTL_MS) drop(id);
  }
}

export function putPdfTicket(userId, buffer, name = 'file.pdf') {
  prune();
  if (!buffer || buffer.length > MAX_BYTES) return null;
  const own = [];
  for (const [id, item] of items) if (item.userId === userId) own.push([id, item]);
  own.sort((a, b) => a[1].at - b[1].at);
  while (own.length >= MAX_PER_USER) {
    const [id] = own.shift();
    drop(id);
  }
  // Общий лимит: вытесняем самые старые файлы, пока новый не поместится.
  while (items.size && totalBytes + buffer.length > MAX_TOTAL_BYTES) {
    let oldestId = null;
    let oldestAt = Infinity;
    for (const [id, item] of items) {
      if (item.at < oldestAt) { oldestAt = item.at; oldestId = id; }
    }
    if (!oldestId) break;
    drop(oldestId);
  }
  if (totalBytes + buffer.length > MAX_TOTAL_BYTES) return null;
  const id = crypto.randomBytes(16).toString('hex');
  items.set(id, { userId, buffer, name: String(name || 'file.pdf'), at: Date.now() });
  totalBytes += buffer.length;
  return id;
}

export function getPdfTicket(id, userId) {
  prune();
  const item = items.get(String(id || ''));
  if (!item || item.userId !== userId) return null;
  item.at = Date.now();
  return item;
}

export function pdfTicketStats() {
  return { count: items.size, bytes: totalBytes, maxBytes: MAX_TOTAL_BYTES };
}
