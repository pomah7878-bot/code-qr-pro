import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '');
const ADMIN_IDS = String(process.env.TELEGRAM_ADMIN_ID || '')
  .split(/[,\s;]+/)
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Telegram Bot API через системный curl.
 * Node fetch с этого сервера до api.telegram.org таймаутится, curl работает стабильно.
 */

export function tgConfigured() {
  return Boolean(TOKEN && ADMIN_IDS.length);
}

export function tgAdminIds() {
  return [...ADMIN_IDS];
}

export function tgIsAdmin(chatId) {
  return ADMIN_IDS.includes(String(chatId));
}

function redact(s) {
  let out = String(s || '');
  if (TOKEN) out = out.split(TOKEN).join('[bot-token]');
  return out.slice(0, 500);
}

async function curl(args, timeoutMs = 25_000) {
  try {
    const { stdout } = await run('/usr/bin/curl', ['-sS', '-m', String(Math.ceil(timeoutMs / 1000)), ...args], {
      timeout: timeoutMs + 5_000,
      maxBuffer: 20 * 1024 * 1024
    });
    return JSON.parse(stdout || '{}');
  } catch (e) {
    throw new Error(redact(e?.stderr || e?.message || e));
  }
}

function apiUrl(method, query = '') {
  return `https://api.telegram.org/bot${TOKEN}/${method}${query ? '?' + query : ''}`;
}

async function call(method, params = {}, timeoutMs = 25_000) {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN не задан');
  if (!params || Object.keys(params).length === 0) {
    const data = await curl([apiUrl(method)], timeoutMs);
    if (!data.ok) throw new Error(data.description || 'Telegram API error');
    return data.result;
  }
  const file = join(tmpdir(), `tg-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(file, JSON.stringify(params));
  try {
    const data = await curl([apiUrl(method), '-H', 'Content-Type: application/json', '--data-binary', '@' + file], timeoutMs);
    if (!data.ok) throw new Error(data.description || 'Telegram API error');
    return data.result;
  } finally {
    unlink(file).catch(() => {});
  }
}

export async function tgGetUpdates(offset = 0, timeoutSec = 25) {
  const q = new URLSearchParams({ offset: String(offset || 0), timeout: String(timeoutSec), allowed_updates: JSON.stringify(['message', 'callback_query']) });
  const data = await curl([apiUrl('getUpdates', q.toString())], (timeoutSec + 10) * 1000);
  if (!data.ok) throw new Error(data.description || 'Telegram getUpdates error');
  return data.result || [];
}

export async function tgSendMessage(chatId, text, options = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text: String(text).slice(0, 4096),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options
  });
}

export async function tgSendDocument(chatId, buffer, filename, caption = '', options = {}) {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN не задан');
  const file = join(tmpdir(), `tg-doc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await writeFile(file, buffer);
  try {
    const args = [
      apiUrl('sendDocument'),
      '-F', `chat_id=${chatId}`,
      '-F', `document=@${file};filename=${String(filename || 'document.pdf').replace(/[^\w.-]/g, '_')}`,
      '-F', 'parse_mode=HTML'
    ];
    if (caption) args.push('-F', `caption=${String(caption).slice(0, 1024)}`);
    if (options.reply_markup) args.push('-F', `reply_markup=${JSON.stringify(options.reply_markup)}`);
    const data = await curl(args, 40_000);
    if (!data.ok) throw new Error(data.description || 'Telegram sendDocument error');
    return data.result;
  } finally {
    unlink(file).catch(() => {});
  }
}

export async function tgDeleteWebhook() {
  try { return await call('deleteWebhook', { drop_pending_updates: false }); } catch { return null; }
}

export async function tgAnswerCallback(callbackId, text = '') {
  return call('answerCallbackQuery', { callback_query_id: callbackId, text: String(text || '').slice(0, 200), show_alert: false });
}

export async function tgGetMe() {
  return call('getMe');
}
