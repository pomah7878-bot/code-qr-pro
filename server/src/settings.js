import { db } from './db.js';
export const getSetting = (k, d = '') => db.prepare('SELECT value FROM app_settings WHERE key=?').get(k)?.value ?? d;
export const setSetting = (k, v) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
