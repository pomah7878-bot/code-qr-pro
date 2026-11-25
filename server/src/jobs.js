import { ZipArchive } from 'archiver';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, createWriteStream, createReadStream, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { toRawGs1, gs1BarcodeText } from './gs1.js';
import { planOf } from './plans.js';
import { renderBarcode } from './lib/barcode-pool.js';
import { artifactKey, ensureArtifactDir, removeArtifact } from './lib/artifacts.js';
import { s3Configured, uploadArtifact, deleteArtifact } from './lib/s3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const JOBS_DIR = process.env.JOBS_DIR || join(__dirname, '..', 'data', 'jobs');

// задания, прерванные перезапуском сервера, помечаем ошибкой
db.prepare("UPDATE generation_jobs SET status='error', error='Прервано перезапуском сервера', finished_at=datetime('now') WHERE status IN ('queued','running')").run();

const queue = [];
let running = false;

// Сколько PNG кодируем параллельно за один заход: пул воркеров загружает ядра,
// а память остаётся небольшой (файлы сразу пишутся на диск).
const RENDER_BATCH = Math.max(4, Number(process.env.JOBS_RENDER_BATCH || 32));

export function enqueue(jobId) {
  queue.push(jobId);
  if (!running) run();
}

async function run() {
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try { await processJob(id); }
    catch (e) {
      db.prepare("UPDATE generation_jobs SET status='error', error=?, finished_at=datetime('now') WHERE id=?")
        .run(String(e?.message || e), id);
    }
  }
  running = false;
}

function bwipOpts(item, mode) {
  const raw = toRawGs1(item.raw || item.normalized || '');
  return {
    bcid: 'datamatrix',
    text: mode === 'text' ? String(item.raw || item.normalized || '') : gs1BarcodeText(raw),
    parsefnc: mode !== 'text',
    scale: 6,
    paddingwidth: 12,
    paddingheight: 12,
    includetext: false
  };
}

export async function renderPNG(item, mode) {
  return renderBarcode(bwipOpts(item, mode), 'png');
}

export async function renderSVG(item, mode) {
  return renderBarcode(bwipOpts(item, mode), 'svg');
}

function renderBatch(items, mode, kind) {
  return Promise.all(items.map((item) => renderBarcode(bwipOpts(item, mode), kind)));
}

async function processJob(jobId) {
  const job = db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(jobId);
  if (!job) return;
  db.prepare("UPDATE generation_jobs SET status='running' WHERE id=?").run(jobId);
  const items = db.prepare("SELECT * FROM job_items WHERE job_id=? AND status='ok' ORDER BY row_index").all(jobId);
  const dir = join(JOBS_DIR, String(jobId));
  mkdirSync(dir, { recursive: true });
  let done = 0;
  // Штрихкоды пачки кодируются параллельно в воркерах; сам пакет не блокирует
  // event loop, поэтому сервер отвечает на запросы во время генерации.
  for (let start = 0; start < items.length; start += RENDER_BATCH) {
    const batch = items.slice(start, start + RENDER_BATCH);
    const pngs = await renderBatch(batch, job.mode, 'png');
    for (let i = 0; i < batch.length; i++) {
      writeFileSync(join(dir, batch[i].row_index + '.png'), pngs[i]);
      db.prepare("UPDATE job_items SET status='generated' WHERE id=?").run(batch[i].id);
    }
    done += batch.length;
    db.prepare('UPDATE generation_jobs SET done=? WHERE id=?').run(done, jobId);
    await new Promise(r => setImmediate(r));
  }
  const user = db.prepare('SELECT plan FROM users WHERE id=?').get(job.user_id);
  const days = Math.max(1, Number(planOf({ id: job.user_id, plan: user?.plan }).historyDays) || 7);
  db.prepare(
    "UPDATE generation_jobs SET done=?, status='done', finished_at=datetime('now'), expires_at=datetime('now','+' || ? || ' days') WHERE id=?"
  ).run(done, days, jobId);
  try {
    await archiveJob(jobId);
  } catch (e) {
    console.error('job archive failed:', e?.message || e);
  }
}

async function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function trimUserStorage(userId, keepJobId, plan, incomingSize) {
  const quota = Math.max(0, Number(plan.archiveMb || 0) * 1024 * 1024);
  let used = Number(db.prepare('SELECT COALESCE(SUM(artifact_size),0) s FROM generation_jobs WHERE user_id=? AND id<>?').get(userId, keepJobId).s || 0);
  if (used + incomingSize <= quota) return true;
  const rows = db.prepare(
    `SELECT id, artifact_key, artifact_size, artifact_backend FROM generation_jobs
     WHERE user_id=? AND id<>? AND artifact_key IS NOT NULL AND artifact_size > 0
     ORDER BY created_at ASC`
  ).all(userId, keepJobId);
  for (const row of rows) {
    if (used + incomingSize <= quota) break;
    if (row.artifact_backend === 's3') await deleteArtifact(row.artifact_key);
    else removeArtifact(row.artifact_key);
    db.prepare("UPDATE generation_jobs SET artifact_key=NULL, artifact_size=0, artifact_backend='local' WHERE id=?").run(row.id);
    used -= Number(row.artifact_size || 0);
  }
  return used + incomingSize <= quota;
}

// Упаковываем результат один раз в ZIP, после чего построчные PNG можно удалить.
export async function archiveJob(jobId) {
  const job = db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(jobId);
  if (!job || job.status !== 'done') return null;
  const items = db.prepare("SELECT * FROM job_items WHERE job_id=? AND status='generated' ORDER BY row_index").all(job.id);
  if (!items.length) return null;
  const user = db.prepare('SELECT plan FROM users WHERE id=?').get(job.user_id);
  const plan = planOf({ id: job.user_id, plan: user?.plan });
  const key = artifactKey(job.user_id, job.id);
  const path = ensureArtifactDir(key);
  const tmp = `${path}.tmp-${process.pid}`;
  const output = createWriteStream(tmp);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const finished = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  // Файлы обычно уже на диске; на случай уборки/перезапуска недостающие PNG
  // добираем пачкой — тоже через пул воркеров, а не по одному в основном потоке.
  const missing = [];
  for (const item of items) {
    const ext = job.format === 'svg' ? 'svg' : 'png';
    const name = `${item.row_index}.${ext}`;
    if (ext === 'svg') {
      missing.push({ item, name, kind: 'svg' });
      continue;
    }
    const p = join(JOBS_DIR, String(job.id), item.row_index + '.png');
    if (existsSync(p)) archive.file(p, { name });
    else missing.push({ item, name, kind: 'png' });
  }
  for (let start = 0; start < missing.length; start += RENDER_BATCH) {
    const batch = missing.slice(start, start + RENDER_BATCH);
    const rendered = await Promise.all(batch.map((x) => renderBarcode(bwipOpts(x.item, job.mode), x.kind)));
    for (let i = 0; i < batch.length; i++) archive.append(rendered[i], { name: batch[i].name });
  }
  await archive.finalize();
  await finished;
  const size = statSync(tmp).size;
  const sha = await sha256File(tmp);
  if (size > Number(plan.archiveMb || 0) * 1024 * 1024) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`Архив ${(size / 1024 / 1024).toFixed(1)} МБ больше лимита ${plan.archiveMb} МБ`);
  }
  const fits = await trimUserStorage(job.user_id, job.id, plan, size);
  if (!fits) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`Не хватает места в архиве: нужно ${(size / 1024 / 1024).toFixed(1)} МБ, лимит ${plan.archiveMb} МБ`);
  }
  let backend = 'local';
  if (s3Configured()) {
    try {
      await uploadArtifact(key, tmp);
      backend = 's3';
      unlinkSync(tmp);
    } catch (e) {
      console.error('S3 upload failed, fallback to local:', e?.message || e);
    }
  }
  if (backend === 'local') renameSync(tmp, path);
  const days = Math.max(1, Number(plan.historyDays) || 7);
  db.prepare(
    `UPDATE generation_jobs
     SET artifact_key=?, artifact_size=?, artifact_sha=?, artifact_backend=?, archived_at=datetime('now'),
         expires_at=COALESCE(expires_at, datetime('now','+' || ? || ' days'))
     WHERE id=?`
  ).run(key, size, sha, backend, days, job.id);
  // построчные файлы больше не нужны: PNG/SVG при необходимости пересоберутся из БД
  try { rmSync(join(JOBS_DIR, String(job.id)), { recursive: true, force: true }); } catch { /* ignore */ }
  return { key, size, sha, backend };
}

export async function removeJobFiles(jobId) {
  const job = db.prepare('SELECT artifact_key, artifact_backend FROM generation_jobs WHERE id=?').get(jobId);
  if (job?.artifact_key) {
    if (job.artifact_backend === 's3') await deleteArtifact(job.artifact_key);
    else removeArtifact(job.artifact_key);
  }
  rmSync(join(JOBS_DIR, String(jobId)), { recursive: true, force: true });
}

export async function cleanupExpiredJobs() {
  try {
    const expired = db.prepare(
      "SELECT id FROM generation_jobs WHERE expires_at IS NOT NULL AND expires_at <= datetime('now') AND status IN ('done','error')"
    ).all();
    for (const job of expired) {
      try { await removeJobFiles(job.id); } catch { /* ignore */ }
      db.prepare('DELETE FROM generation_jobs WHERE id=?').run(job.id);
    }
    // Корзина: окончательно удаляем задания, пролежавшие в ней больше 30 дней.
    const trashed = db.prepare("SELECT id FROM generation_jobs WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now','-30 days')").all();
    for (const job of trashed) {
      try { await removeJobFiles(job.id); } catch { /* ignore */ }
      db.prepare('DELETE FROM job_comments WHERE job_id=?').run(job.id);
      db.prepare('DELETE FROM job_items WHERE job_id=?').run(job.id);
      db.prepare('DELETE FROM generation_jobs WHERE id=?').run(job.id);
    }
    db.prepare("DELETE FROM activity_log WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
  } catch (e) {
    console.error('history cleanup failed:', e?.message || e);
  }
}
