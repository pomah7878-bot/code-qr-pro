import { db } from './db.js';
import { encryptSecret, decryptSecret, isEncrypted } from './lib/secrets.js';

const SENSITIVE = new Set(['smtp_pass', 'cz_token', 'mail_unsub_secret', 's3_access_key', 's3_secret_key']);

export const getSetting = (k, d = '') => {
  const value = db.prepare('SELECT value FROM app_settings WHERE key=?').get(k)?.value;
  if (value === undefined || value === null) return d;
  if (SENSITIVE.has(k) && isEncrypted(value)) return decryptSecret(value) || d;
  return value;
};

export const setSetting = (k, v) => {
  const value = SENSITIVE.has(k) && String(v) !== '' ? encryptSecret(String(v)) : String(v);
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(k, value);
};

// Прозрачно шифруем секреты, сохранённые старой версией в открытом виде.
for (const key of SENSITIVE) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);
  if (row?.value && !isEncrypted(row.value)) setSetting(key, row.value);
}
