import { createCipheriv, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { encryptionKey } from '../src/lib/secrets.js';
const dir = process.env.BACKUP_DIR || '/opt/backups/code-qr';
for (const name of readdirSync(dir)) {
  if (name.endsWith('.enc')) continue;
  if (!/\.db(\.gz)?$/.test(name)) continue;
  const src = join(dir, name);
  const out = src + '.enc';
  if (existsSync(out)) continue;
  const plain = readFileSync(src);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  writeFileSync(out, Buffer.concat([Buffer.from('CQRE1'), iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
  unlinkSync(src);
  console.log('encrypted', name, plain.length);
}
