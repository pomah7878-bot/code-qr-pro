import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || join(__dirname, '..', '..', 'data', 'artifacts');

export const artifactKey = (userId, jobId) => `${Number(userId)}/${Number(jobId)}.zip`;

export function artifactPath(key) {
  if (!key || !/^\d+\/\d+\.zip$/.test(String(key))) return null;
  const full = normalize(join(ARTIFACTS_DIR, String(key)));
  if (!full.startsWith(normalize(ARTIFACTS_DIR + sep))) return null;
  return full;
}

export function ensureArtifactDir(key) {
  const path = artifactPath(key);
  if (!path) throw new Error('Некорректный ключ архива');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return path;
}

export function artifactExists(key) {
  const path = artifactPath(key);
  return Boolean(path && existsSync(path));
}

export function artifactStats(key) {
  const path = artifactPath(key);
  if (!path || !existsSync(path)) return null;
  const st = statSync(path);
  return { path, size: st.size, mtime: st.mtime };
}

export function removeArtifact(key) {
  const path = artifactPath(key);
  if (path && existsSync(path)) {
    try { unlinkSync(path); } catch { /* ignore */ }
  }
}

export function openArtifact(key) {
  const path = artifactPath(key);
  return path && existsSync(path) ? createReadStream(path) : null;
}
