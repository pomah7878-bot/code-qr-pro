import Database from 'better-sqlite3';
import { createCipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptionKey, keyFilePath } from '../src/lib/secrets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, '..', 'data', 'app.db');
const outDir = process.env.BACKUP_DIR || '/opt/backups/code-qr';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const tmp = join(outDir, `.tmp-${process.pid}.db`);
const out = join(outDir, `app-${stamp}.db.enc`);

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true, mode: 0o700 });
const db = new Database(dbPath, { readonly: true });
await db.backup(tmp);
db.close();

const plain = readFileSync(tmp);
rmSync(tmp, { force: true });
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();
writeFileSync(out, Buffer.concat([Buffer.from('CQRE1'), iv, tag, encrypted]), { mode: 0o600 });

const files = readdirSync(outDir)
  .filter((f) => /^app-\d{8}-\d{6}\.db\.enc$/.test(f))
  .map((f) => ({ f, t: statSync(join(outDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
for (const old of files.slice(14)) unlinkSync(join(outDir, old.f));

console.log(JSON.stringify({ ok: true, file: out, bytes: plain.length, keyFile: keyFilePath() }));
