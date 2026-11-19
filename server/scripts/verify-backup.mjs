import Database from 'better-sqlite3';
import { createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptionKey, keyFilePath } from '../src/lib/secrets.js';

const backupDir = process.env.BACKUP_DIR || '/opt/backups/code-qr';
const candidate = process.argv[2] || (() => {
  if (!existsSync(backupDir)) return null;
  return readdirSync(backupDir)
    .filter((f) => /^app-\d{8}-\d{6}\.db\.enc$/.test(f))
    .map((f) => ({ f, t: statSync(join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]?.f || null;
})();

if (!candidate) {
  console.error(JSON.stringify({ ok: false, error: 'backup not found', backupDir }));
  process.exit(1);
}

const file = candidate.includes('/') || candidate.includes('\\') ? candidate : join(backupDir, candidate);
if (!process.env.APP_ENCRYPTION_KEY && !existsSync(keyFilePath())) {
  console.error(JSON.stringify({ ok: false, error: 'encryption key not found', keyFile: keyFilePath() }));
  process.exit(1);
}
const buf = readFileSync(file);
if (buf.length < 34 || buf.subarray(0, 5).toString() !== 'CQRE1') {
  console.error(JSON.stringify({ ok: false, error: 'not a CQRE1 encrypted backup', file }));
  process.exit(1);
}

const iv = buf.subarray(5, 17);
const tag = buf.subarray(17, 33);
const ciphertext = buf.subarray(33);
const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
decipher.setAuthTag(tag);
let plain;
try {
  plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
} catch {
  console.error(JSON.stringify({ ok: false, error: 'decrypt failed (wrong key or corrupted backup)', file, keyFile: keyFilePath() }));
  process.exit(1);
}

const tmp = join(tmpdir(), `cq-restore-check-${process.pid}.db`);
let db;
try {
  writeFileSync(tmp, plain, { mode: 0o600 });
  db = new Database(tmp, { readonly: true });
  const integrity = db.pragma('integrity_check', { simple: true });
  const version = db.pragma('user_version', { simple: true });
  const tables = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c;
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const jobs = db.prepare('SELECT COUNT(*) c FROM generation_jobs').get().c;
  const orders = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const result = {
    ok: integrity === 'ok',
    file,
    keyFile: keyFilePath(),
    bytes: plain.length,
    integrity,
    userVersion: version,
    tables,
    users,
    jobs,
    orders
  };
  console.log(JSON.stringify(result));
  if (integrity !== 'ok') process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e), file }));
  process.exitCode = 1;
} finally {
  try { db?.close(); } catch { /* ignore */ }
  try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
}
