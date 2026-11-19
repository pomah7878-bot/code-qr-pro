import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = dirname(process.env.DB_PATH || join(__dirname, '..', '..', 'data', 'app.db'));
const keyFile = process.env.APP_KEY_FILE || join(dataDir, '.app-key');
let cachedKey = null;

function key() {
  if (cachedKey) return cachedKey;
  if (process.env.APP_ENCRYPTION_KEY) {
    const fromEnv = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'base64');
    if (fromEnv.length === 32) { cachedKey = fromEnv; return cachedKey; }
    throw new Error('APP_ENCRYPTION_KEY должен быть base64 от 32 байт');
  }
  if (existsSync(keyFile)) {
    const fromFile = readFileSync(keyFile);
    if (fromFile.length === 32) {
      try { chmodSync(keyFile, 0o600); } catch { /* not owner */ }
      cachedKey = fromFile;
      return cachedKey;
    }
  }
  const generated = randomBytes(32);
  writeFileSync(keyFile, generated, { mode: 0o600 });
  try { chmodSync(keyFile, 0o600); } catch { /* not owner */ }
  cachedKey = generated;
  return cachedKey;
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

export function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value) {
  if (!isEncrypted(value)) return value;
  try {
    const [, , ivB64, tagB64, dataB64] = value.split(':');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function encryptionKey() {
  return key();
}

export function keyFilePath() {
  return keyFile;
}
