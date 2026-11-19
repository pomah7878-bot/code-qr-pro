import Database from 'better-sqlite3';
import { createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encryptionKey, keyFilePath } from '../src/lib/secrets.js';

const source = process.argv[2];
const target = process.argv[3];
const force = process.argv.includes('--force');
if (!source || !target) {
  console.error('Usage: node scripts/restore-backup.mjs <backup.db.enc> <target.db> [--force]');
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(JSON.stringify({ ok: false, error: 'backup not found', file: source }));
  process.exit(1);
}
if (existsSync(target) && !force) {
  console.error(JSON.stringify({ ok: false, error: 'target exists; use --force to replace', file: target }));
  process.exit(1);
}
if (!process.env.APP_ENCRYPTION_KEY && !existsSync(keyFilePath())) {
  console.error(JSON.stringify({ ok: false, error: 'encryption key not found', keyFile: keyFilePath() }));
  process.exit(1);
}

const buf = readFileSync(source);
if (buf.length < 34 || buf.subarray(0, 5).toString() !== 'CQRE1') {
  console.error(JSON.stringify({ ok: false, error: 'not a CQRE1 encrypted backup', file: source }));
  process.exit(1);
}
const iv = buf.subarray(5, 17);
const tag = buf.subarray(17, 33);
const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
decipher.setAuthTag(tag);
let plain;
try {
  plain = Buffer.concat([decipher.update(buf.subarray(33)), decipher.final()]);
} catch {
  console.error(JSON.stringify({ ok: false, error: 'decrypt failed (wrong key or corrupted backup)', file: source }));
  process.exit(1);
}

const tmp = join(dirname(target), `.restore-${process.pid}.db`);
try {
  writeFileSync(tmp, plain, { mode: 0o600 });
  const db = new Database(tmp, { readonly: true });
  const integrity = db.pragma('integrity_check', { simple: true });
  const version = db.pragma('user_version', { simple: true });
  db.close();
  if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`);
  renameSync(tmp, target);
  console.log(JSON.stringify({ ok: true, file: target, bytes: plain.length, integrity, userVersion: version, keyFile: keyFilePath() }));
} catch (e) {
  try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e), target }));
  process.exit(1);
}
