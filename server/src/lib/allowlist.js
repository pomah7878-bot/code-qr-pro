import { db } from '../db.js';

/**
 * Белый список IP: такие адреса не упираются в антиспам (офис клиента,
 * склад, интегратор). Список кэшируется в памяти и обновляется при изменении
 * и раз в 30 секунд — чтобы не читать БД на каждый запрос.
 */

let cache = new Set();

export function refreshAllowlist() {
  try {
    cache = new Set(db.prepare('SELECT ip FROM ip_allowlist').all().map((r) => r.ip));
  } catch {
    cache = new Set();
  }
  return cache;
}

export function isAllowlisted(ip) {
  return Boolean(ip) && cache.has(String(ip));
}

export function allowlistRows() {
  return db.prepare('SELECT id, ip, note, created_by, created_at FROM ip_allowlist ORDER BY id DESC').all();
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6 = /^[0-9a-fA-F:]{3,45}$/;

export function validIp(ip) {
  const value = String(ip || '').trim();
  if (IPV4.test(value)) return true;
  if (value.includes(':') && IPV6.test(value)) return true;
  return false;
}

refreshAllowlist();
setInterval(refreshAllowlist, 30_000).unref();
