// Привязка Telegram-чата склада к аккаунту для доставки пик-листов.
// Одноразовый токен живёт 10 минут; бот получает /start mp_<token> и сохраняет chat_id.
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { tgConfigured, tgGetMe } from './telegram-api.js';

let botUsernameCache = '';

export async function botUsername() {
  if (botUsernameCache) return botUsernameCache;
  try {
    const me = await tgGetMe();
    botUsernameCache = String(me?.username || 'CODE_QR_PRO_bot');
  } catch { botUsernameCache = 'CODE_QR_PRO_bot'; }
  return botUsernameCache;
}

export function telegramReady() {
  return tgConfigured();
}

export function getMarketplaceTgLink(userId) {
  return db.prepare('SELECT * FROM marketplace_tg_links WHERE user_id=?').get(userId) || null;
}

export async function createMarketplaceTgLink(userId) {
  const token = randomBytes(16).toString('hex');
  db.prepare('DELETE FROM marketplace_tg_tokens WHERE user_id=?').run(userId);
  db.prepare("INSERT INTO marketplace_tg_tokens (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))").run(token, userId);
  const username = await botUsername();
  return { token, url: 'https://t.me/' + username + '?start=mp_' + token };
}

export function consumeMarketplaceTgToken(token, chatId, title) {
  const row = db.prepare("SELECT * FROM marketplace_tg_tokens WHERE token=? AND expires_at > datetime('now')").get(String(token || ''));
  if (!row) return { ok: false };
  db.prepare("INSERT INTO marketplace_tg_links (user_id, chat_id, title) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id, title=excluded.title, linked_at=datetime('now')")
    .run(row.user_id, String(chatId), String(title || '').slice(0, 200));
  db.prepare('DELETE FROM marketplace_tg_tokens WHERE token=?').run(row.token);
  return { ok: true, userId: row.user_id };
}

export function unlinkMarketplaceTg(userId) {
  db.prepare('DELETE FROM marketplace_tg_links WHERE user_id=?').run(userId);
  db.prepare('DELETE FROM marketplace_tg_tokens WHERE user_id=?').run(userId);
}
