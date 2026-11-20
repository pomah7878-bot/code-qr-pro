import crypto from 'node:crypto';

/**
 * Короткоживущие ссылки на готовые PDF.
 *
 * Зачем: iOS Safari не открывает PDF из blob: (пустой экран) и не сохраняет
 * его через атрибут download. Поэтому сервер отдаёт документ по обычному
 * URL — тогда Safari показывает встроенный просмотрщик с «Поделиться».
 *
 * Файлы живут в памяти: TTL 10 минут и максимум 10 штук на пользователя.
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_PER_USER = 10;
const MAX_BYTES = 60 * 1024 * 1024;

const items = new Map();

function prune() {
  const now = Date.now();
  for (const [id, item] of items) {
    if (now - item.at > TTL_MS) items.delete(id);
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
    items.delete(id);
  }
  const id = crypto.randomBytes(16).toString('hex');
  items.set(id, { userId, buffer, name: String(name || 'file.pdf'), at: Date.now() });
  return id;
}

export function getPdfTicket(id, userId) {
  prune();
  const item = items.get(String(id || ''));
  if (!item || item.userId !== userId) return null;
  item.at = Date.now();
  return item;
}
